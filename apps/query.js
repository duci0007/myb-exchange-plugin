import Cfg from '../model/Cfg.js'
import MysApi from '../model/mys/mysApi.js'
import Account from '../model/account.js'

export class Query extends plugin {
  constructor () {
    super({
      name: '米游币兑换:查询',
      dsc: '查询当前账号的米游币余额',
      event: 'message',
      priority: Cfg.get('plugin.priority', 100),
      rule: [
        { reg: '^#米游币查询$', fnc: 'balanceCmd', permission: 'all' }
      ]
    })
  }

  get _userId () {
    return this.e?.user_id ? String(this.e.user_id) : Account.getDefaultUserId()
  }

  async balanceCmd () {
    const userId = this._userId
    const accounts = await Account.listAccounts(userId)
    if (!accounts.length) {
      await this.reply('❌ 未绑定任何账号，请先使用 #绑定Cookie 绑定')
      return false
    }

    await this.reply('⏳ 正在查询米游币余额...')

    const lines = []
    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i]
      const mysApi = new MysApi(acc.ck, acc.device || '')
      const stokenData = await Account.getStokenByLtuid(userId, acc.ltuid)
      const res = await mysApi.getMybBalance(stokenData)

      if (res.retcode !== 0 || !res.data) {
        lines.push(`${i + 1}. ❌ ltuid ${acc.ltuid}：${res.message || '查询失败'}`)
        continue
      }

      const d = res.data
      const total = d.total_points ?? 0
      const canGet = d.can_get_points ?? 0
      const state = d.can_get_points === 0 ? '✅ 今日任务已完成' : '⏳ 今日任务未完成'
      lines.push(
        `${i + 1}. 💰 ${total} 米游币 | ltuid: ${acc.ltuid}\n` +
        `   📊 今日剩余可获取：${canGet} | ${state}`
      )
    }

    await this.reply(
      `📋 米游币余额查询\n用户：${userId}\n\n` +
      lines.join('\n\n'),
      true
    )
    return false
  }
}
