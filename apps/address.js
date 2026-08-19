import Cfg from '../model/Cfg.js'
import MysApi from '../model/mys/mysApi.js'
import Account from '../model/account.js'

// TRSSYz 的 setContext/getContext/finish 不生效，用内存 Map 替代
const pendingAddressMap = new Map() // userId -> { addresses, timer }

export class Address extends plugin {
  constructor () {
    super({
      name: '米游币兑换:地址',
      dsc: '收货地址管理',
      event: 'message',
      priority: Cfg.get('plugin.priority', 100),
      rule: [
        { reg: '^#米游币地址(.+)?$', fnc: 'addressCmd', permission: 'all' },
        // 兜底规则：TRSSYz 的 setContext 不生效，用 RegExp 字面量捕获任意消息
        { reg: /.*/, fnc: 'handlePendingAddress', permission: 'all' }
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
      addrMsg += `   收件人：${addr.connect_name} | ${addr.connect_mobile}\n\n`
    })

    await this.reply(addrMsg, true)

    // 用内存 Map 替代 setContext（TRSSYz 不兼容）
    const userId = this._userId
    this._clearPending(userId)
    const timer = setTimeout(() => {
      pendingAddressMap.delete(userId)
    }, 10 * 60 * 1000) // 10 分钟超时
    pendingAddressMap.set(userId, { addresses: addrList, timer })

    return true
  }

  async selectAddress () {
    const userId = this._userId
    const input = this.e.msg.trim()
    const idx = parseInt(input) - 1
    const pending = pendingAddressMap.get(userId)
    if (!pending) return false

    if (input === '取消') {
      this._clearPending(userId)
      await this.reply('❌ 已取消地址设置')
      return false
    }

    const { addresses } = pending
    if (isNaN(idx) || idx < 0 || idx >= addresses.length) {
      await this.reply('⚠️ 序号无效，请重新输入')
      return true
    }

    const addr = addresses[idx]
    await this._saveAddress(addr)

    this._clearPending(userId)
    await this.reply(`📍 已设置收货地址：\n${addr.addr_ext || addr.connect_addr}`)
    return false
  }

  /** 兜底处理器：TRSSYz 的 setContext 机制不生效，用此方法捕获待处理的地址选择 */
  async handlePendingAddress () {
    const userId = this._userId
    if (!pendingAddressMap.has(userId)) return false // 无待处理上下文，放行

    // 如果用户发送了其他命令，取消待处理并放行
    const input = this.e.msg.trim()
    if (input.startsWith('#')) {
      this._clearPending(userId)
      return false
    }

    return this.selectAddress()
  }

  _clearPending (userId) {
    const pending = pendingAddressMap.get(userId)
    if (pending) {
      clearTimeout(pending.timer)
      pendingAddressMap.delete(userId)
    }
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