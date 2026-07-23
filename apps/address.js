import Cfg from '../model/Cfg.js'
import MysApi from '../model/mys/mysApi.js'
import Account from '../model/account.js'

export class Address extends plugin {
  constructor () {
    super({
      name: '米游币兑换:地址',
      dsc: '收货地址管理',
      event: 'message',
      priority: Cfg.get('plugin.priority', 100),
      rule: [
        { reg: '^#米游币地址(.+)?$', fnc: 'addressCmd', permission: 'all' }
      ]
    })
  }

  get _userId () {
    return this.e?.user_id ? String(this.e.user_id) : Account.getDefaultUserId()
  }

  async addressCmd () {
    const msg = this.e.msg.replace(/^#?米游币地址\s*/, '').trim()
    if (msg === '查看' || msg === 'list') return this._listAddress()
    return this._setAddress()
  }

  async _setAddress () {
    const account = await Account.get(this._userId)
    if (!account?.cookie) {
      await this.reply('❌ 未找到 Cookie，请先绑定账号')
      return false
    }

    await this.reply('⏳ 正在获取收货地址列表...')

    const mysApi = new MysApi(account.cookie, account.device)
    const t = Math.round(new Date().getTime())
    const res = await mysApi.getAddress(t)

    if (res.retcode !== 0 || !res.data?.list) {
      await this.reply(`❌ 获取地址失败：${res.message || '未知错误'}`)
      return false
    }

    const addrList = res.data.list
    if (!addrList.length) {
      await this.reply('⚠️ 你还没有收货地址，请先在米游社APP添加地址')
      return false
    }

    if (addrList.length === 1) {
      const addr = addrList[0]
      await this._saveAddress(addr)
      await this.reply(`📍 已设置收货地址：\n${addr.addr_ext || addr.connect_addr}`)
      return false
    }

    let addrMsg = '📍 请选择收货地址（发送序号）：\n\n'
    addrList.forEach((addr, i) => {
      const defaultTag = addr.is_default ? '【默认】' : ''
      addrMsg += `${i + 1}. ${defaultTag}${addr.addr_ext || addr.connect_addr}\n`
      addrMsg += `   收件人：${addr.recipient_name} | ${addr.recipient_phone}\n\n`
    })

    await this.reply(addrMsg, true)
    this.setContext('selectAddress', { addresses: addrList, timeout: 60, prompt: '' })
    return true
  }

  async selectAddress () {
    const input = this.e.msg.trim()
    const idx = parseInt(input) - 1
    const ctx = this.getContext('selectAddress')
    if (!ctx) return false

    const { addresses } = ctx
    if (isNaN(idx) || idx < 0 || idx >= addresses.length) {
      await this.reply('⚠️ 序号无效，请重新输入')
      return true
    }

    const addr = addresses[idx]
    await this._saveAddress(addr)

    this.finish('selectAddress')
    await this.reply(`📍 已设置收货地址：\n${addr.addr_ext || addr.connect_addr}`)
    return false
  }

  async _saveAddress (addr) {
    const data = { id: String(addr.id), addr_ext: addr.addr_ext || addr.connect_addr }
    const json = JSON.stringify(data)
    // Redis 缓存（30天）
    await redis.set(`myb_exchange_address:${this._userId}`, json, { EX: 30 * 24 * 3600 })
    // 文件兜底：Redis 重启会清空内存，文件不会丢
    const { default: Cfg } = await import('../model/Cfg.js')
    Cfg.setData(`address_${this._userId}.json`, data)
  }

  async _listAddress () {
    const addrStr = await redis.get(`myb_exchange_address:${this._userId}`)
    if (addrStr) {
      try {
        const addr = JSON.parse(addrStr)
        await this.reply(`📍 当前收货地址：\n${addr.addr_ext}`)
      } catch {
        await this.reply('⚠️ 地址数据异常，请重新设置')
      }
    } else {
      await this.reply('⚠️ 还未设置收货地址')
    }
    return false
  }
}
