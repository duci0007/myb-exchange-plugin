import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import Cfg from './Cfg.js'
import MysApi from './mys/mysApi.js'
import Account from './account.js'

class HealthChecker {
  constructor () {
    this.timer = null
    this.lastStatus = {}
    this.masters = this._loadMasters()
  }

  _loadMasters () {
    try {
      const otherPath = path.join(process.cwd(), 'config', 'config', 'other.yaml')
      if (!fs.existsSync(otherPath)) return []
      const content = fs.readFileSync(otherPath, 'utf-8')
      const cfg = YAML.parse(content) || {}
      const masters = []
      if (Array.isArray(cfg.masterQQ)) {
        for (const qq of cfg.masterQQ) {
          const s = String(qq).trim()
          if (s && s !== 'stdin' && /^\d+$/.test(s)) masters.push(s)
        }
      }
      if (Array.isArray(cfg.master)) {
        for (const item of cfg.master) {
          const s = String(item).trim()
          const parts = s.split(':')
          if (parts.length >= 2) {
            const qq = parts[1].trim()
            if (qq && qq !== 'stdin' && /^\d+$/.test(qq) && !masters.includes(qq)) {
              masters.push(qq)
            }
          }
        }
      }
      return [...new Set(masters)]
    } catch (e) {
      logger.error(`[兑换插件]读取 master 配置失败: ${e.message}`)
      return []
    }
  }

  init () {
    if (!Cfg.get('healthCheck.enable', true)) {
      logger.mark('[兑换插件]健康检测已关闭')
      return
    }

    const intervalDays = Cfg.get('healthCheck.intervalDays', 3)
    const hour = Cfg.get('healthCheck.hour', 4)

    logger.mark(`[兑换插件]健康检测已启动，每 ${intervalDays} 天 ${hour}:00 检测一次`)

    this._scheduleNext(intervalDays, hour)
  }

  _scheduleNext (intervalDays, hour) {
    if (this.timer) clearTimeout(this.timer)

    const now = new Date()
    const next = new Date(now)
    next.setDate(now.getDate() + intervalDays)
    next.setHours(hour, 0, 0, 0)

    const delay = next.getTime() - now.getTime()

    this.timer = setTimeout(() => {
      this.runCheck().catch(e => {
        logger.error(`[兑换插件]健康检测异常: ${e.message}`)
      }).finally(() => {
        this._scheduleNext(intervalDays, hour)
      })
    }, delay)

    logger.mark(`[兑换插件]下次检测时间：${next.toLocaleString('zh-CN')}`)
  }

  async runCheck () {
    logger.mark('[兑换插件]开始执行接口健康检测...')

    const results = await this._checkAll()
    const allOk = results.every(r => r.ok)

    for (const r of results) {
      const prevOk = this.lastStatus[r.name]
      this.lastStatus[r.name] = r.ok

      if (!r.ok && prevOk !== false) {
        await this._notifyMaster(r.name, false, r.message)
      } else if (r.ok && prevOk === false && Cfg.get('healthCheck.notifyOnRecover', true)) {
        await this._notifyMaster(r.name, true, r.message)
      }
    }

    if (allOk) {
      logger.mark('[兑换插件]健康检测完成，所有接口正常')
    } else {
      const failed = results.filter(r => !r.ok).map(r => r.name).join('、')
      logger.warn(`[兑换插件]健康检测完成，异常接口：${failed}`)
    }

    return results
  }

  async _checkAll () {
    const results = []
    const game = Cfg.get('healthCheck.game', 'hk4e')

    let testAccount = null
    try {
      const allAccounts = await Account.listAccounts(Account.getDefaultUserId())
      if (allAccounts.length) {
        testAccount = allAccounts[0]
      }
    } catch (e) {
      logger.warn(`[兑换插件]健康检测：获取测试账号失败: ${e.message}`)
    }

    if (!testAccount) {
      results.push({
        name: '测试账号',
        ok: false,
        message: '未找到可用的测试账号 Cookie，请先绑定米游社账号'
      })
      return results
    }

    const mysApi = new MysApi(testAccount.ck, testAccount.device || '')

    try {
      const res = await mysApi.getGoodList(game, 1, 5)
      if (res.retcode === 0 && res.data?.list) {
        results.push({ name: '商品列表接口', ok: true, message: '正常' })
      } else {
        results.push({
          name: '商品列表接口',
          ok: false,
          message: `retcode=${res.retcode}, msg=${res.message || '未知错误'}`
        })
      }
    } catch (e) {
      results.push({ name: '商品列表接口', ok: false, message: e.message })
    }

    try {
      const stokenData = await Account.getStokenByLtuid(Account.getDefaultUserId(), testAccount.ltuid)
      const res = await mysApi.getMybBalance(stokenData)
      if (res.retcode === 0 && res.data) {
        results.push({ name: '米游币查询接口', ok: true, message: '正常' })
      } else {
        results.push({
          name: '米游币查询接口',
          ok: false,
          message: `retcode=${res.retcode}, msg=${res.message || '未知错误'}`
        })
      }
    } catch (e) {
      results.push({ name: '米游币查询接口', ok: false, message: e.message })
    }

    return results
  }

  async _notifyMaster (apiName, isRecover, message) {
    if (!this.masters.length) {
      logger.warn('[兑换插件]未配置 master，跳过通知')
      return
    }

    const title = isRecover ? '✅ 接口恢复正常' : '❌ 接口异常告警'
    const msg =
      `${title}\n` +
      `📦 插件：米游币兑换\n` +
      `🔧 接口：${apiName}\n` +
      `📝 详情：${message}\n` +
      `⏰ 时间：${new Date().toLocaleString('zh-CN')}\n\n` +
      `💡 请尝试更新插件或联系插件作者更新`

    for (const qq of this.masters) {
      try {
        if (!Bot?.pickUser) continue
        const user = Bot.pickUser(Number(qq))
        if (user?.sendMsg) {
          await user.sendMsg(msg)
          logger.mark(`[兑换插件]已通知 master ${qq}`)
        }
      } catch (e) {
        logger.error(`[兑换插件]通知 master ${qq} 失败: ${e.message}`)
      }
    }
  }

  stop () {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}

export default new HealthChecker()
