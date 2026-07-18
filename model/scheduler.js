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
    logger.mark(`[兑换插件]调度器初始化完成，当前待兑换计划：${ExchangePlanManager.listPendingPlans().length} 个`)
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

    const timer = setTimeout(() => {
      this.executePlan(plan).catch(e => {
        logger.error(`[兑换插件]执行计划 ${plan.id} 异常: ${e.message}`)
      })
    }, delay)

    this.timers.set(plan.id, timer)
    logger.mark(`[兑换插件]已调度计划 ${plan.id} (${plan.goodsName})，${(delay / 1000).toFixed(0)} 秒后开始`)
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

    // 获取账号凭据：优先用游戏 UID 定位对应账号
    let account
    if (plan.gameUid) {
      const game = mapGameBizToKey(plan.gameBiz) || 'gs'
      account = await Account.getByUid(plan.userId, plan.gameUid, game)
    }
    if (!account) {
      account = await Account.get(plan.userId)
    }

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

    const threadCount = Cfg.get('exchange.threadCount', 3)
    const sleepTime = Cfg.get('exchange.sleepTime', 100)
    const retryCount = Cfg.get('exchange.retryCount', 2)

    const tasks = []
    for (let i = 0; i < threadCount; i++) {
      tasks.push(this._doExchange(plan, account, i, retryCount))
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

  async _doExchange (plan, account, threadIndex, retryCount) {
    const mysApi = new MysApi(account.cookie, plan.deviceId, plan.deviceFp)
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
          await new Promise(r => setTimeout(r, 500))
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
          await new Promise(r => setTimeout(r, 500))
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
