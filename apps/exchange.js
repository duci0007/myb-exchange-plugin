import Cfg from '../model/Cfg.js'
import ExchangePlanManager from '../model/exchangePlan.js'
import MysApi from '../model/mys/mysApi.js'
import Scheduler from '../model/scheduler.js'
import Account from '../model/account.js'
import mysTool from '../model/mys/mysTool.js'
import { GAME_MAP, mapGameBizToKey, gameLabel } from '../model/gameMap.js'

export class Exchange extends plugin {
  constructor () {
    super({
      name: '米游币兑换:计划',
      dsc: '米游社商品兑换计划管理',
      event: 'message',
      priority: Cfg.get('plugin.priority', 100),
      rule: [
        { reg: '^#米游币兑换(.+)?$', fnc: 'exchangeCmd', permission: 'all' },
        { reg: '^#兑换计划删除(.+)?$', fnc: 'removePlanByIndex', permission: 'all' },
        { reg: '^#兑换计划$', fnc: 'listPlans', permission: 'all' }
      ]
    })
  }

  get _userId () {
    return this.e?.user_id ? String(this.e.user_id) : Account.getDefaultUserId()
  }

  async exchangeCmd () {
    const msg = this.e.msg.replace(/^#?米游币兑换\s*/, '').trim()
    if (!msg) return false

    if (msg === '列表' || msg === 'list') return this.listPlans()

    const quick = this._parseQuickAdd(msg)
    if (quick) return this._quickAdd(quick.gameKey, quick.index)

    return false
  }

  _parseQuickAdd (msg) {
    // 匹配：类别名 + 数字序号，例如 "原神1"、"星铁3"、"ys2"
    const catKeys = Object.keys(GAME_MAP).sort((a, b) => b.length - a.length)
    for (const cat of catKeys) {
      if (msg.startsWith(cat)) {
        const rest = msg.slice(cat.length)
        const m = /^(\d+)/.exec(rest)
        if (m) {
          return {
            gameKey: GAME_MAP[cat],
            gameLabel: cat,
            index: parseInt(m[1])
          }
        }
      }
    }
    return null
  }

  async _quickAdd (gameKey, index) {
    if (index < 1 || index > 99) {
      await this.reply('⚠️ 序号无效')
      return false
    }
    const userId = this._userId
    const account = await Account.get(userId)
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
      const total = res.data.total
      if (total && allGoods.length >= total) break
      page++
    }

    if (!allGoods.length) {
      await this.reply('❌ 未找到商品列表')
      return false
    }

    const timeGoods = allGoods.filter(g => (g.unlimit === false || g.unlimit === 0) && g.next_time)
    const displayGoods = (timeGoods.length ? timeGoods : allGoods.slice(0, 20)).slice(0, 20)

    if (index > displayGoods.length) {
      await this.reply(`❌ 序号超出范围，当前共 ${displayGoods.length} 个限时商品`)
      return false
    }

    const goodsId = displayGoods[index - 1].goods_id
    return this._addPlan(String(goodsId))
  }

  async _addPlan (args) {
    // 支持：商品ID   或   商品ID UID
    const parts = args.split(/\s+/).filter(Boolean)
    const goodsId = parts[0]
    const specifiedUid = parts[1] || ''

    if (!/^\d+$/.test(goodsId)) {
      await this.reply('⚠️ 商品ID必须为数字')
      return false
    }

    const userId = this._userId
    const account = await Account.get(userId)
    if (!account?.cookie) {
      await this.reply('❌ 未找到 Cookie，请先使用 #绑定Cookie 绑定账号')
      return false
    }

    await this.reply('⏳ 正在获取商品详情...')

    try {
      const mysApi = new MysApi(account.cookie, account.device)
      const detailRes = await mysApi.getGoodDetail(goodsId)

      if (detailRes.retcode !== 0 || !detailRes.data) {
        await this.reply(`❌ 获取商品详情失败：${detailRes.message || '未知错误'}`)
        return false
      }

      const good = detailRes.data
      if (good.unlimit === true || good.unlimit === 1) {
        await this.reply('❌ 该商品不是限时可兑换商品')
        return false
      }

      const isVirtual = Number(good.type) === 1
      const exchangeTime = Number(good.next_time) || Number(good.start) || 0

      if (exchangeTime * 1000 < Date.now()) {
        await this.reply('❌ 该商品已过兑换时间')
        return false
      }

      // 先确定使用哪个账号，再做重复/余额检查，避免不必要的 getFp 请求
      let useAccount = account
      let useUid = ''
      let addr = null

      if (isVirtual) {
        // 虚拟商品：自动用当前游戏的主 UID；用户也可在指令中带 UID 指定
        const gameKey = mapGameBizToKey(good.game_biz || '')

        if (specifiedUid) {
          // 校验用户指定的 UID 是否在该用户绑定列表里
          const verifyAccount = await Account.getByUid(userId, specifiedUid, gameKey)
          if (!verifyAccount?.cookie) {
            await this.reply(`❌ 未找到 UID ${specifiedUid} 对应的账号 Cookie\n请确认该 UID 已通过 #绑定uid 绑定`)
            return false
          }
          useUid = String(specifiedUid)
          useAccount = verifyAccount
        } else {
          // 直接读取本体绑定的当前游戏主 UID
          const gameAccount = await Account.get(userId, gameKey || 'gs')
          if (!gameAccount?.cookie) {
            await this.reply(`❌ 未找到当前${gameLabel(gameKey)}账号\n请先使用 #绑定uid 切换账号，或在指令中带上 UID`)
            return false
          }
          if (!gameAccount.uid) {
            await this.reply('❌ 未找到当前选中 UID\n请先使用 #绑定uid 切换账号')
            return false
          }
          useUid = String(gameAccount.uid)
          useAccount = gameAccount
        }
      } else {
        // 实物商品：使用收货地址
        addr = await this._getAddress()
        if (!addr) {
          await this.reply('⚠️ 请先设置收货地址\n发送：#米游币地址')
          return false
        }
      }

      // 重复检查：同一账号同一商品不允许重复添加 pending 计划
      if (ExchangePlanManager.hasPendingByGoodsId(userId, goodsId, useAccount.ltuid)) {
        await this.reply(
          `❌ 该账号已添加过该商品的兑换计划，不能重复添加\n\n` +
          `📦 商品：${good.goods_name || '未命名'}\n` +
          `💰 价格：${good.price} 米游币\n` +
          `⏰ 开兑时间：${this._formatTime(exchangeTime)}`
        )
        return false
      }

      // 余额检查：查询该账号当前米游币，扣除该账号所有 pending 计划占用
      const balanceMysApi = new MysApi(useAccount.cookie, useAccount.device)
      const stokenData = await Account.getStokenByLtuid(userId, useAccount.ltuid)
      const balanceRes = await balanceMysApi.getMybBalance(stokenData)
      if (balanceRes.retcode === 0 && balanceRes.data) {
        const currentBalance = balanceRes.data.total_points ?? 0
        const pendingPlans = ExchangePlanManager.listPendingByLtuid(useAccount.ltuid)
        const occupied = pendingPlans.reduce((sum, p) => sum + (Number(p.price) || 0), 0)
        const available = currentBalance - occupied
        if (good.price > available) {
          await this.reply(
            `❌ 当前米游币数量不足以兑换该商品，添加失败\n\n` +
            `💰 当前余额：${currentBalance}\n` +
            `📌 已占用：${occupied}（${pendingPlans.length} 个待兑换计划）\n` +
            `✨ 可用：${available}\n` +
            `📦 商品需要：${good.price}`
          )
          return false
        }
      } else {
        logger.warn(`[兑换插件]查询余额失败，跳过余额检查: retcode=${balanceRes.retcode}, msg=${balanceRes.message}`)
      }

      const planData = {
        goodsId: String(goodsId),
        goodsName: good.goods_name || '未命名',
        price: good.price || 0,
        exchangeTime: exchangeTime,
        isVirtual: isVirtual,
        gameBiz: good.game_biz || '',
        ltuid: useAccount.ltuid,
        deviceId: useAccount.device || account.device || mysTool.getDeviceGuid(),
        deviceFp: ''
      }

      if (isVirtual) {
        planData.gameUid = useUid
        planData.region = this._guessRegion(useUid)
      } else {
        planData.addressId = addr.id
        planData.addressText = addr.addr_ext
      }

      // 获取设备指纹
      const fpMysApi = new MysApi(useAccount.cookie, planData.deviceId)
      const fp = await fpMysApi.getFp()
      if (fp) planData.deviceFp = fp

      const plan = ExchangePlanManager.addPlan(userId, planData)
      const scheduled = Scheduler.schedulePlan(plan)

      let replyMsg =
        `🎉 兑换计划已添加！\n` +
        `📦 商品：${plan.goodsName}\n` +
        `💰 价格：${plan.price} 米游币\n` +
        `⏰ 开兑时间：${this._formatTime(plan.exchangeTime)}\n`
      if (planData.gameUid) replyMsg += `🎮 接收 UID：${planData.gameUid}\n`
      if (planData.addressText) replyMsg += `📍 收货地址：${planData.addressText}\n`
      replyMsg += scheduled
        ? '\n💡 将在开兑前自动开始抢兑'
        : '\n⚠️ 该商品已过开兑时间，不会自动抢兑'
      await this.reply(replyMsg, true)
      return false
    } catch (e) {
      logger.error(`[兑换插件]添加兑换计划异常: ${e.message}`)
      await this.reply(`❌ 添加兑换计划时发生错误：${e.message}\n请检查账号状态或稍后再试`)
      return false
    }
  }

  _guessRegion (uid) {
    if (!uid) return ''
    uid = String(uid)
    const first = uid[0]
    if (first === '5') return 'cn_qd01'
    return 'cn_gf01'
  }

  async _getOrderedPlans (userId) {
    const plans = ExchangePlanManager.listUserPlans(userId)
    if (!plans.length) {
      return { groups: [], flatList: [], total: 0, accountCount: 0 }
    }

    const accounts = await Account.listAccounts(userId)
    const ltuidOrder = accounts.map(a => a.ltuid)

    const groupsMap = {}
    for (const plan of plans) {
      const key = plan.ltuid || 'unknown'
      if (!groupsMap[key]) groupsMap[key] = []
      groupsMap[key].push(plan)
    }

    let sortedKeys = ltuidOrder.filter(k => groupsMap[k])
    if (groupsMap['unknown']) sortedKeys.push('unknown')
    // 已解绑或 listAccounts 异常时，确保计划仍显示出来
    for (const k of Object.keys(groupsMap)) {
      if (!sortedKeys.includes(k)) sortedKeys.push(k)
    }

    const groups = []
    const flatList = []
    let globalIndex = 0

    for (let i = 0; i < sortedKeys.length; i++) {
      const ltuid = sortedKeys[i]
      const groupPlans = groupsMap[ltuid]
      const groupPlansWithIndex = groupPlans.map(p => {
        globalIndex++
        return {
          ...p,
          globalIndex,
          timeText: this._formatTime(p.exchangeTime)
        }
      })
      groups.push({
        ltuid,
        accountLabel: `账号${i + 1}`,
        plans: groupPlansWithIndex
      })
      flatList.push(...groupPlansWithIndex)
    }

    return { groups, flatList, total: flatList.length, accountCount: groups.length }
  }

  async removePlanByIndex () {
    const msg = this.e.msg.replace(/^#?兑换计划删除\s*/, '').trim()
    const idx = parseInt(msg)
    if (isNaN(idx) || idx < 1) {
      await this.reply('⚠️ 请输入正确的序号\n例如：#兑换计划删除2')
      return false
    }
    const { flatList, total } = await this._getOrderedPlans(this._userId)
    if (!total) {
      await this.reply('📋 你还没有兑换计划')
      return false
    }
    if (idx > total) {
      await this.reply(`❌ 序号超出范围，当前共 ${total} 个兑换计划`)
      return false
    }
    const plan = flatList[idx - 1]
    Scheduler.cancelPlan(plan.id)
    ExchangePlanManager.removePlan(this._userId, plan.id)
    await this.reply(`🗑️ 已删除第 ${idx} 个兑换计划：${plan.goodsName}`)
    return false
  }

  async listPlans () {
    const { groups, total, accountCount } = await this._getOrderedPlans(this._userId)
    if (!total) {
      await this.reply('📋 你还没有兑换计划\n使用 #米游币商品 <类别> 查看商品，再用 #米游币兑换<类别><序号> 添加')
      return false
    }

    const e = this.e
    if (!e.runtime) {
      await this.reply(this._buildTextPlanList(groups, total, accountCount), true)
      return false
    }

    try {
      await e.runtime.render('myb-exchange-plugin', 'plans/index', {
        groups,
        total,
        accountCount,
        saveId: 'index'
      })
    } catch (err) {
      logger.error(`[兑换插件]计划图片渲染失败: ${err.message}`)
      await this.reply(this._buildTextPlanList(groups, total, accountCount), true)
    }
    return false
  }

  _buildTextPlanList (groups, total, accountCount) {
    let msg = '📋 我的兑换计划\n\n'
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]
      msg += `═══ ${group.accountLabel} ═══\n`
      for (const plan of group.plans) {
        const statusText = {
          pending: '⏳ 待兑换',
          success: '✅ 兑换成功',
          failed: '❌ 兑换失败'
        }[plan.status] || plan.status
        msg += `${plan.globalIndex}. 📦 ${plan.goodsName}\n`
        msg += `   💰 ${plan.price} 米游币 | ${statusText}\n`
        msg += `   ⏰ ${plan.timeText}\n`
        if (plan.gameUid) msg += `   🎮 UID：${plan.gameUid}\n`
        if (plan.addressText) msg += `   📍 地址：${plan.addressText}\n`
        if (plan.result?.message) msg += `   📝 ${plan.result.message}\n`
        msg += `   ID: ${plan.goodsId}\n\n`
      }
    }
    msg += `共 ${total} 个计划，分布在 ${accountCount} 个账号`
    return msg
  }

  async _getAddress () {
    const addrStr = await redis.get(`myb_exchange_address:${this._userId}`)
    if (addrStr) {
      try { return JSON.parse(addrStr) } catch { return null }
    }
    return null
  }

  _formatTime (timestamp) {
    if (!timestamp) return '未知'
    const d = new Date(timestamp * 1000)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }
}
