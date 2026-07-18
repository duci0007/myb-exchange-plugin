import Cfg from '../model/Cfg.js'
import Account from '../model/account.js'

export class AccountApp extends plugin {
  constructor () {
    super({
      name: '米游币兑换:账号',
      dsc: '查看绑定的米游社账号列表',
      event: 'message',
      priority: Cfg.get('plugin.priority', 100),
      rule: [
        { reg: '^#米游币账号(.+)?$', fnc: 'accountCmd', permission: 'all' }
      ]
    })
  }

  get _userId () {
    return this.e?.user_id ? String(this.e.user_id) : Account.getDefaultUserId()
  }

  async accountCmd () {
    const userId = this._userId
    const accounts = await Account.listAccounts(userId)
    const uids = await Account.listGameUids(userId)

    if (!accounts.length && !uids.length) {
      await this.reply(`❌ 用户 ${userId} 未绑定任何账号\n请使用 #绑定Cookie 绑定米游社账号`)
      return false
    }

    let msg = `📋 账号列表 (用户: ${userId})\n\n`

    msg += `--- 米游社账号 (${accounts.length}个) ---\n`
    for (const [i, acc] of accounts.entries()) {
      msg += `${i + 1}. ltuid: ${acc.ltuid}\n`
      msg += `   cookie: ${(acc.ck || '').slice(0, 30)}...\n`
      const uidInfo = []
      for (const [game, ids] of Object.entries(acc.uids)) {
        if (Array.isArray(ids) && ids.length) {
          uidInfo.push(`${game}: ${ids.join(', ')}`)
        }
      }
      msg += `   绑定角色: ${uidInfo.join(' | ') || '无'}\n\n`
    }

    msg += `--- 游戏角色 (${uids.length}个) ---\n`
    const gameNames = { gs: '原神', sr: '星穹铁道', zzz: '绝区零', bh3: '崩坏3', nxx: '未定事件簿' }
    for (const uid of uids) {
      msg += `${gameNames[uid.game] || uid.game} | UID: ${uid.uid}`
      if (uid.region) msg += ` | ${uid.region}`
      if (uid.nickname) msg += ` | ${uid.nickname}`
      msg += `\n`
    }

    msg += `\n💡 使用 #绑定uid 切换当前账号`
    await this.reply(msg, true)
    return false
  }
}
