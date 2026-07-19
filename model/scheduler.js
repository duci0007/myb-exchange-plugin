import Cfg from './Cfg.js'
import ExchangePlanManager from './exchangePlan.js'
import MysApi from './mys/mysApi.js'
import Account from './account.js'
import { mapGameBizToKey } from './gameMap.js'

class ExchangeScheduler {
  constructor () {
    this.timers = new Map()
  }

  init () {
    this.rescheduleAll()
  }

  rescheduleAll () {
    for (const [id, timer] of this.timers) {
      clearTimeout(timer)
    }
    this.timers.clear()

    const pending = ExchangePlanManager.listPendingPlans()
    for (const plan of pending) {
      this.schedulePlan(plan)
    }
  }

  schedulePlan (plan) {
    const now = Date.now()
    const exchangeTimeMs = plan.exchangeTime * 1000
    const preTime = Cfg.get('exchange.preExchangeTime', 100)
    const delay = exchangeTimeMs - now - preTime

    if (delay <= 0) {
      logger.warn(`[兑换插件]计划 ${plan.id} (${plan.goodsName}) 已过开兑时间，跳过`)
      return false
    }

    if (this.timers.has(plan.id)) {
      clearTimeout(this.timers.get(plan.id))
    }

    // Node.js setTimeout 最大安全延迟约 24.8 天（2^31 - 1 ms）
    // 超过时分段重调度，避免立即触发的 bug
    const MAX_TIMEOUT = 2147483647
    const safeDelay = Math.min(delay, MAX_TIMEOUT)
    const needsReschedule = delay > MAX_TIMEOUT

    const timer = setTimeout(() => {
      if (needsReschedule) {
        // 还未到时间，重新调度
        this.timers.delete(plan.id)
        this.schedulePlan(plan)
        return
      }
      // 执行时使用最新 plan 数据，避免使用调度时的闭包快照
      const freshPlan = ExchangePlanManager.getPlan(plan.id)
      if (!freshPlan) {
        this.timers.delete(plan.id)
        return
      }
      this.executePlan(freshPlan).catch(e => {
        logger.error(`[兑换插件]执行计划 ${plan.id} 异常: ${e.message}`)
      })
    }, safeDelay)

    this.timers.set(plan.id, timer)
    logger.debug(`[兑换插件]已调度计划 ${plan.id} (${plan.goodsName})，${(delay / 1000).toFixed(0)} 秒后开始`)
    return true
  }

  cancelPlan (planId) {
    if (this.timers.has(planId)) {
      clearTimeout(this.timers.get(planId))
      this.timers.delete(planId)
      return true
    }
    return false
  }

  async executePlan (plan) {
    logger.mark(`[兑换插件]开始执行兑换计划 ${plan.id} (${plan.goodsName})`)

    // 计划可能已被用户删除，执行前再次确认
    if (!ExchangePlanManager.getPlan(plan.id)) {
      logger.warn(`[兑换插件]计划 ${plan.id} 已被删除，取消执行`)
      this.timers.delete(plan.id)
      return { success: false }
    }

    // 并行：账号凭据查询 + HTTP 连接预热（DNS/TLS 握手）
    const accountPromise = (async () => {
      if (plan.gameUid) {
        const game = mapGameBizToKey(plan.gameBiz) || 'gs'
        const acc = await Account.getByUid(plan.userId, plan.gameUid, game)
        if (acc) return { account: acc, source: `UID ${plan.gameUid} (${game})` }
      }
      const acc = await Account.get(plan.userId)
      if (acc) return { account: acc, source: '默认账号' }
      return { account: null, source: '' }
    })()

    const warmupMysApi = new MysApi('', plan.deviceId, plan.deviceFp)
    const warmupPromise = warmupMysApi.warmup()

    const { account, source: accountSource } = await accountPromise

    if (!account?.cookie) {
      logger.error(`[兑换插件]用户 ${plan.userId} 无可用凭据，跳过兑换`)
      ExchangePlanManager.updatePlan(plan.id, {
        status: 'failed',
        result: { success: false, retcode: -1, message: '未找到 Cookie，请先绑定账号' },
        finishedAt: Date.now()
      })
      this.timers.delete(plan.id)
      await this._notifyResult(plan, false, { message: '未找到可用凭据' }, [])
      return { success: false }
    }

    // 等待预热完成（通常已在账号查询期间完成）
    await warmupPromise

    logger.mark(`[兑换插件]计划 ${plan.id} 使用账号 ${accountSource || account.ltuid} 进行兑换`)

    const threadCount = Cfg.get('exchange.threadCount', 3)
    const sleepTime = Cfg.get('exchange.sleepTime', 100)
    const retryCount = Cfg.get('exchange.retryCount', 2)

    // 所有线程共享同一个 MysApi 实例（Cookie/DeviceId/FP 一致）
    const sharedMysApi = new MysApi(account.cookie, plan.deviceId, plan.deviceFp)

    const tasks = []
    for (let i = 0; i < threadCount; i++) {
      tasks.push(this._doExchange(plan, sharedMysApi, i, retryCount))
      if (i < threadCount - 1) {
        await new Promise(r => setTimeout(r, sleepTime))
      }
    }

    const allResults = await Promise.allSettled(tasks)
    const results = []
    let success = false
    let result = null

    for (const r of allResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value)
        if (r.value?.success && !success) {
          success = true
          result = r.value
        }
      }
    }

    ExchangePlanManager.updatePlan(plan.id, {
      status: success ? 'success' : 'failed',
      result: result || results[0] || null,
      finishedAt: Date.now()
    })

    this.timers.delete(plan.id)
    await this._notifyResult(plan, success, result, results)

    return { success, result, results }
  }

  async _doExchange (plan, mysApi, threadIndex, retryCount) {
    const retryInterval = Cfg.get('exchange.retryInterval', 200)
    let lastResult = null

    for (let retry = 0; retry <= retryCount; retry++) {
      try {
        const start = Date.now()
        const res = await mysApi.exchange(
          plan.goodsId,
          plan.addressId,
          plan.gameUid,
          plan.region,
          plan.gameBiz
        )
        const elapsed = Date.now() - start

        if (res.retcode === 0) {
          logger.mark(`[兑换插件][线程${threadIndex}]兑换成功！${plan.goodsName}，耗时 ${elapsed}ms`)
          return {
            success: true,
            retcode: 0,
            message: res.message || '兑换成功',
            data: res.data,
            thread: threadIndex,
            elapsed
          }
        }

        lastResult = {
          success: false,
          retcode: res.retcode,
          message: res.message || '兑换失败',
          data: res.data,
          thread: threadIndex,
          elapsed
        }

        if ([-100, 1034, 5003, 10035, 10041].includes(res.retcode) ||
            res.message?.includes('验证') || res.message?.includes('风险')) {
          logger.warn(`[兑换插件][线程${threadIndex}]触发验证码（retcode=${res.retcode}），本插件不处理`)
          lastResult.message = `触发验证码: ${res.message || ''}（请确保 ji-plugin 已开启全局验证码处理）`
          return lastResult
        }

        logger.warn(`[兑换插件][线程${threadIndex}]兑换失败: retcode=${res.retcode}, msg=${res.message}, 耗时 ${elapsed}ms, 第${retry + 1}次`)

        if (retry < retryCount) {
          await new Promise(r => setTimeout(r, retryInterval))
        }
      } catch (e) {
        logger.error(`[兑换插件][线程${threadIndex}]兑换异常: ${e.message}, 第${retry + 1}次`)
        lastResult = {
          success: false,
          retcode: -1,
          message: e.message,
          thread: threadIndex
        }
        if (retry < retryCount) {
          await new Promise(r => setTimeout(r, retryInterval))
        }
      }
    }

    return lastResult || { success: false, retcode: -2, message: '重试次数耗尽', thread: threadIndex }
  }

  async _notifyResult (plan, success, result, allResults) {
    try {
      const userId = plan.userId
      if (userId === 'stdin' || !Bot?.pickUser) return

      const user = Bot.pickUser(Number(userId))
      let msg = ''
      if (success) {
        msg = `🎉 兑换成功！\n` +
          `📦 商品：${plan.goodsName}\n` +
          `💰 价格：${plan.price} 米游币\n` +
          `⏱️ 耗时：${result?.elapsed || 0}ms\n` +
          `📝 消息：${result?.message || '成功'}`
      } else {
        const firstResult = allResults[0] || {}
        msg = `❌ 兑换失败\n` +
          `📦 商品：${plan.goodsName}\n` +
          `💰 价格：${plan.price} 米游币\n` +
          `📝 错误：${firstResult?.message || '未知错误'}\n` +
          `🔢 错误码：${firstResult?.retcode || '?'}`
      }

      await user.sendMsg(msg).catch(err => {
        logger.error(`[兑换插件]发送通知失败: ${err.message}`)
      })
    } catch (e) {
      logger.error(`[兑换插件]通知异常: ${e.message}`)
    }
  }

}

export default new ExchangeScheduler()
