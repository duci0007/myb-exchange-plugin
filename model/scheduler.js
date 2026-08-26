import Cfg from './Cfg.js'
import ExchangePlanManager from './exchangePlan.js'
import MysApi from './mys/mysApi.js'
import Account from './account.js'
import { mapGameBizToKey } from './gameMap.js'

/**
 * 确定性失败错误码——重试无意义，命中任一应立即停止所有线程
 * - 库存不足 / 已售罄 / 不在兑换期：-2102, -2001, 2026
 * - 登录失效：-100
 *
 * 注意：-2106（不在商品可兑换时间中）单独处理——开售瞬间本地时钟快于服务端时
 * 也会返回此码，故在开售后短窗口内重试自救（见 _doExchange），出窗口才终止。
 * 5003/10035/10041/1034 属于验证码/风控/登录态过期，由 ji-plugin 过码插件统一处理。
 */
const TERMINAL_ERRORS = new Set([-2102, -2001, 2026, -100])

// -2106 开售边界自救窗口：开售后该窗口内 -2106 视为本地时钟偏差，继续基础间隔重试
const EXCHANGE_START_GRACE_MS = 3000

/**
 * 同账号并发闸门：多个兑换计划共用同一账号（ltuid）时，共享 exchange.threadCount 个并发槽位。
 * 实测同账号 2 计划 × 3 线程 = 6 个并发请求会全部触发米游社 1028 风控，两个计划全灭；
 * 限制同时在飞的请求数后，后续计划的线程会在前面请求返回后立即补位，形成自然交错。
 */
const accountGates = new Map()

async function _acquireAccountSlot (gateKey, max) {
  let gate = accountGates.get(gateKey)
  if (!gate) {
    gate = { active: 0, queue: [] }
    accountGates.set(gateKey, gate)
  }
  if (gate.active < max) {
    gate.active++
    return
  }
  await new Promise(resolve => gate.queue.push(resolve))
}

function _releaseAccountSlot (gateKey) {
  const gate = accountGates.get(gateKey)
  if (!gate) return
  const next = gate.queue.shift()
  if (next) {
    // 槽位直接转移给下一个等待线程（active 不变）
    next()
  } else {
    gate.active--
    if (gate.active <= 0) accountGates.delete(gateKey)
  }
}

async function _readAddressFromStorage (userId) {
  const key = `myb_exchange_address:${userId}`
  try {
    const cached = await redis.get(key)
    if (cached) return JSON.parse(cached)
  } catch {}
  try {
    const data = Cfg.getData(`address_${userId}.json`)
    if (data?.id) {
      await redis.set(key, JSON.stringify(data), { EX: 30 * 24 * 3600 })
      return data
    }
  } catch {}
  return null
}

class ExchangeScheduler {
  constructor () {
    this.timers = new Map()
  }

  init () {
    this.cleanupExpired()
    this.rescheduleAll()
  }

  /** 清理已过兑换时间超过 5 分钟的计划（无论成功/失败/pending） */
  cleanupExpired () {
    const expireAfterMs = Cfg.get('exchange.expireAfterMin', 5) * 60 * 1000
    const now = Date.now()
    const all = ExchangePlanManager.listAll()
    for (const plan of all) {
      if (!plan.exchangeTime) continue
      const expireAt = plan.exchangeTime * 1000 + expireAfterMs
      if (now >= expireAt) {
        this.timers.delete(plan.id)
        ExchangePlanManager.removePlanById(plan.id)
        logger.debug(`[兑换插件]计划 ${plan.id} (${plan.goodsName}) 已过期超过 ${Cfg.get('exchange.expireAfterMin', 5)} 分钟，自动删除`)
      }
    }
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

    // 实物商品：若计划创建时地址为空（旧数据或 Redis 已过期），执行前补读
    if (!plan.addressId) {
      const addr = await _readAddressFromStorage(plan.userId)
      if (!addr) {
        logger.error(`[兑换插件]计划 ${plan.id} 缺少收货地址，请先执行 #米游币地址 设置`)
        ExchangePlanManager.updatePlan(plan.id, {
          status: 'failed',
          result: { success: false, retcode: -1, message: '缺少收货地址，请先设置' },
          finishedAt: Date.now()
        })
        this.timers.delete(plan.id)
        await this._notifyResult(plan, false, { message: '缺少收货地址，请先执行 #米游币地址 设置' }, [])
        return { success: false }
      }
      ExchangePlanManager.updatePlan(plan.id, { addressId: addr.id, addressText: addr.addr_ext })
      plan = { ...plan, addressId: addr.id, addressText: addr.addr_ext }
      logger.info(`[兑换插件]计划 ${plan.id} 补充收货地址: ${addr.addr_ext}`)
    }

    logger.mark(`[兑换插件]计划 ${plan.id} 使用账号 ${accountSource || account.ltuid} 进行兑换`)

    const threadCount = Cfg.get('exchange.threadCount', 3)
    const sleepTime = Cfg.get('exchange.sleepTime', 100)
    const retryCount = Cfg.get('exchange.retryCount', 2)

    // 所有线程共享同一个 MysApi 实例（Cookie/DeviceId/FP 一致）
    const sharedMysApi = new MysApi(account.cookie, plan.deviceId, plan.deviceFp)

    // 共享停止信号：任一线程成功或命中确定性失败（库存不足/登录失效等）时，通知其余线程立即停止
    const stopSignal = { stopped: false }

    // 抢兑关键：账号查询/连接预热/地址补读均已提前完成。
    // 按预热实测 RTT 的一半提前发出请求（封顶 300ms 防异常 RTT），
    // 使请求尽量在服务端开售瞬间到达，而非等本地到点才发、到达时已晚半个 RTT。
    const leadMs = Math.min(Math.round((warmupMysApi.lastRtt || 0) / 2), 300)
    const remainMs = plan.exchangeTime * 1000 - leadMs - Date.now()
    if (remainMs > 0) {
      await new Promise(r => setTimeout(r, remainMs))
    }

    const tasks = []
    // 计划短标识（id 后缀），用于线程日志区分并发的多个计划
    const planTag = String(plan.id).split('_').pop()
    // 同账号并发闸门 key：多计划共用同一账号时共享并发槽位，避免瞬时并发触发 1028 风控
    const gateKey = `ltuid_${account.ltuid || account.uid || 'default'}`
    for (let i = 0; i < threadCount; i++) {
      tasks.push(this._doExchange(plan, sharedMysApi, i, retryCount, stopSignal, planTag, gateKey))
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

  async _doExchange (plan, mysApi, threadIndex, retryCount, stopSignal, planTag = '', gateKey = '') {
    const retryInterval = Cfg.get('exchange.retryInterval', 200)
    const gateMax = Cfg.get('exchange.threadCount', 3)
    const logTag = planTag ? `${planTag}][线程${threadIndex}` : `线程${threadIndex}`
    let lastResult = null

    for (let retry = 0; retry <= retryCount; retry++) {
      // 其它线程已成功/命中确定性失败，直接停止，不再做无意义重试
      if (stopSignal?.stopped) {
        logger.debug(`[兑换插件][${logTag}]收到停止信号，提前退出`)
        break
      }

      try {
        // 同账号并发闸门：等待槽位期间其它线程可能已成功/终止，拿到槽位后需再次确认
        if (gateKey) {
          await _acquireAccountSlot(gateKey, gateMax)
          if (stopSignal?.stopped) {
            _releaseAccountSlot(gateKey)
            logger.debug(`[兑换插件][${logTag}]等待并发槽位期间收到停止信号，提前退出`)
            break
          }
        }

        const start = Date.now()
        let res
        try {
          res = await mysApi.exchange(
            plan.goodsId,
            plan.addressId,
            plan.gameUid,
            plan.region,
            plan.gameBiz
          )
        } finally {
          if (gateKey) _releaseAccountSlot(gateKey)
        }
        const elapsed = Date.now() - start

        if (res.retcode === 0) {
          stopSignal && (stopSignal.stopped = true)
          logger.mark(`[兑换插件][${logTag}]兑换成功！${plan.goodsName}，耗时 ${elapsed}ms`)
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

        // 登录失效 -100：确定性失败（1034 交给过码插件，见下方验证码分支）
        if (res.retcode === -100) {
          lastResult.message = `登录失效: ${res.message || ''}（请重新登录后重试）`
          lastResult.loginExpired = true
        }

        // -2106（不在商品可兑换时间中）：开售瞬间本地时钟略快于服务端时也会返回此码。
        // 开售后短窗口内视为开售边界，用基础间隔重试自救；出窗口或重试耗尽才终止。
        if (res.retcode === -2106) {
          const sinceStart = Date.now() - plan.exchangeTime * 1000
          if (sinceStart < EXCHANGE_START_GRACE_MS && retry < retryCount) {
            logger.warn(`[兑换插件][${logTag}]不在可兑换时间（retcode=-2106，开售边界/时钟偏差），${retryInterval}ms 后重试，第${retry + 1}次`)
            await new Promise(r => setTimeout(r, retryInterval))
            continue
          }
          lastResult.message = '不在商品可兑换时间中（商品可能已被抢空或未到开售时间）'
          stopSignal && (stopSignal.stopped = true)
          logger.warn(`[兑换插件][${logTag}]确定性失败（retcode=-2106, ${res.message}），停止全部线程`)
          return lastResult
        }

        // 确定性失败：库存不足/售罄/不在兑换期/登录失效(-100)，广播停止
        if (TERMINAL_ERRORS.has(res.retcode)) {
          stopSignal && (stopSignal.stopped = true)
          logger.warn(`[兑换插件][${logTag}]确定性失败（retcode=${res.retcode}, ${res.message}），停止全部线程`)
          return lastResult
        }

        // 验证码/风控/登录态过期（5003/10035/10041/1034）：交给 ji-plugin 过码插件处理，
        // 不终止，用较长间隔重试，给过码插件留处理时间
        if ([5003, 10035, 10041, 1034].includes(res.retcode) ||
            res.message?.includes('验证') || res.message?.includes('风险')) {
          lastResult.message = `触发验证码: ${res.message || ''}（过码插件处理中）`
          const captchaBackoff = retryInterval * 5 + Math.floor(Math.random() * 500)
          if (retry < retryCount) {
            logger.warn(`[兑换插件][${logTag}]触发验证码/风控（retcode=${res.retcode}），等待过码插件处理 ${captchaBackoff}ms 后重试，第${retry + 1}次`)
            await new Promise(r => setTimeout(r, captchaBackoff))
          } else {
            logger.warn(`[兑换插件][${logTag}]触发验证码/风控（retcode=${res.retcode}），重试次数耗尽`)
          }
          continue
        }

        // 限流时使用指数退避（参照 tenacity 的 wait_exponential），不视为确定性失败
        if (res.retcode === -429 || res.rateLimited) {
          const baseBackoff = retryInterval * 2
          const expBackoff = Math.min(baseBackoff * Math.pow(2, retry), 10000)
          const jitter = Math.floor(Math.random() * 300)
          let backoff = expBackoff + jitter
          // 开售边界窗口内封顶退避时长，避免指数退避拖过整个抢兑窗口
          if (Date.now() - plan.exchangeTime * 1000 < EXCHANGE_START_GRACE_MS) {
            backoff = Math.min(backoff, 800)
          }
          if (retry < retryCount) {
            logger.warn(`[兑换插件][${logTag}]触发限流，等待 ${backoff}ms 后重试，第${retry + 1}次`)
            await new Promise(r => setTimeout(r, backoff))
          } else {
            logger.warn(`[兑换插件][${logTag}]触发限流（retcode=${res.retcode}），重试次数耗尽`)
          }
          continue
        }

        logger.warn(`[兑换插件][${logTag}]兑换失败: retcode=${res.retcode}, msg=${res.message}, 耗时 ${elapsed}ms, 第${retry + 1}次`)

        if (retry < retryCount) {
          // 加随机抖动，错开多线程重试时间
          const jitter = Math.floor(Math.random() * 100)
          await new Promise(r => setTimeout(r, retryInterval + jitter))
        }
      } catch (e) {
        logger.error(`[兑换插件][${logTag}]兑换异常: ${e.message}, 第${retry + 1}次`)
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
        // 错误展示优先级：终端错误（库存不足/售罄/登录失效）> 其它业务错误 > 限流/异常。
        // 终端错误最能反映真实失败原因，避免被排在前面的限流/-2007 等瞬时噪音掩盖
        const informativeResult = allResults.find(r => TERMINAL_ERRORS.has(r?.retcode)) ||
          allResults.find(r =>
            r?.retcode !== -429 && r?.retcode !== 1028 && r?.retcode !== -1 && r?.retcode !== -2
          ) || allResults[0] || {}

        let errorDetail = `📝 错误：${informativeResult?.message || '未知错误'}\n` +
          `🔢 错误码：${informativeResult?.retcode || '?'}`

        // 登录失效提示（仅 -100）
        if (informativeResult?.loginExpired || informativeResult?.retcode === -100) {
          errorDetail += '\n💡 请重新登录后重试'
        }

        // -2007 未登录：同账号并发抢兑时服务端也会瞬时返回此码（并非 Cookie 真失效）
        if (informativeResult?.retcode === -2007) {
          errorDetail += '\n💡 多为瞬时风控或登录态过期：请检查账号登录状态；同账号多个计划同时兑换会加剧此类失败'
        }

        // 所有线程都限流（HTTP 429 或 1028 风控）
        if ([-429, 1028].includes(informativeResult?.retcode) &&
            allResults.every(r => r?.retcode === -429 || r?.retcode === 1028 || r?.retcode === -2)) {
          errorDetail += '\n💡 请求过于频繁，可尝试减少兑换线程数'
        }

        msg = `❌ 兑换失败\n` +
          `📦 商品：${plan.goodsName}\n` +
          `💰 价格：${plan.price} 米游币\n` +
          errorDetail
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
