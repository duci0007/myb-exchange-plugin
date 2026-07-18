import Cfg from '../model/Cfg.js'
import MysApi from '../model/mys/mysApi.js'
import Account from '../model/account.js'
import { GAME_MAP } from '../model/gameMap.js'

export class Goods extends plugin {
  constructor () {
    super({
      name: '米游币兑换:商品',
      dsc: '米游社商品列表查询',
      event: 'message',
      priority: Cfg.get('plugin.priority', 100),
      rule: [
        { reg: '^#米游币商品(.+)?$', fnc: 'goodsCmd', permission: 'all' }
      ]
    })
  }

  get _userId () {
    return this.e?.user_id ? String(this.e.user_id) : Account.getDefaultUserId()
  }

  async goodsCmd () {
    const e = this.e
    const msg = e.msg.replace(/^#?米游币商品\s*/, '').trim()

    if (!msg) {
      const cats = [...new Set(Object.keys(GAME_MAP))].slice(0, 14).join('、')
      await this.reply(`请输入商品类别：\n${cats}\n\n例如：#米游币商品 原神`)
      return false
    }

    const gameKey = GAME_MAP[msg] || msg
    const account = await Account.get(this._userId)
    if (!account?.cookie) {
      await this.reply('❌ 未找到 Cookie，请先使用 #绑定Cookie 绑定账号')
      return false
    }

    await this.reply('⏳ 正在获取商品列表...')

    const mysApi = new MysApi(account.cookie, account.device)
    const allGoods = []
    let page = 1

    while (page <= 5) {
      const res = await mysApi.getGoodList(gameKey, page, 20)
      if (res.retcode !== 0 || !res.data?.list) break
      const list = res.data.list
      if (!list.length) break
      allGoods.push(...list)
      const total = res.data.total || 0
      if (allGoods.length >= total) break
      page++
    }

    if (!allGoods.length) {
      await this.reply(`暂无 ${msg} 类别的可兑换商品`)
      return false
    }

    const timeGoods = allGoods.filter(g => (g.unlimit === false || g.unlimit === 0) && g.next_time)
    const displayGoods = (timeGoods.length ? timeGoods : allGoods.slice(0, 20)).slice(0, 20)

    // 预处理时间字段，避免在模板中调用方法
    const renderGoods = displayGoods.map(g => ({
      goods_id: g.goods_id,
      goods_name: g.goods_name || '未命名',
      price: g.price,
      icon: g.icon || '',
      timeText: g.next_time ? this._formatTime(g.next_time) : '不限时'
    }))

    if (!e.runtime) {
      await this.reply(this._buildTextList(msg, renderGoods), true)
      return false
    }

    try {
      await e.runtime.render('myb-exchange-plugin', 'goods/index', {
        catName: msg,
        goods: renderGoods,
        saveId: 'index'
      })
    } catch (err) {
      logger.error(`[兑换插件]商品图片渲染失败: ${err.message}`)
      await this.reply(this._buildTextList(msg, renderGoods), true)
    }
    return false
  }

  _buildTextList (catName, goods) {
    let msgText = `📦 ${catName} 商品列表（共 ${goods.length} 个）\n\n`
    for (let i = 0; i < goods.length; i++) {
      const g = goods[i]
      msgText += `${i + 1}. 【${g.goods_id}】${g.goods_name}\n`
      msgText += `   💰 ${g.price} 米游币 | ⏰ ${g.timeText}\n\n`
    }
    return msgText
  }

  _formatTime (timestamp) {
    if (!timestamp) return '未知'
    const d = new Date(timestamp * 1000)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
}
