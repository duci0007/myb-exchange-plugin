import Cfg from './Cfg.js'
import _ from 'lodash'

const DATA_FILE = 'exchangePlans.json'

class ExchangePlanManager {
  constructor () {
    this.plans = this._load()
  }

  _load () {
    const data = Cfg.getData(DATA_FILE)
    return data.plans || []
  }

  _save () {
    Cfg.setData(DATA_FILE, { plans: this.plans })
  }

  addPlan (userId, plan) {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const newPlan = {
      id,
      userId: String(userId),
      goodsId: plan.goodsId,
      goodsName: plan.goodsName || '',
      price: plan.price || 0,
      exchangeTime: plan.exchangeTime || 0,
      isVirtual: plan.isVirtual || false,
      gameBiz: plan.gameBiz || '',
      gameUid: plan.gameUid || '',
      ltuid: plan.ltuid || '',
      region: plan.region || '',
      addressId: plan.addressId || '',
      addressText: plan.addressText || '',
      deviceId: plan.deviceId || '',
      deviceFp: plan.deviceFp || '',
      status: 'pending',
      result: null,
      createdAt: Date.now()
    }
    this.plans.push(newPlan)
    this._save()
    return newPlan
  }

  removePlan (userId, planId) {
    const idx = this.plans.findIndex(p => p.id === planId && p.userId === String(userId))
    if (idx > -1) {
      const plan = this.plans[idx]
      this.plans.splice(idx, 1)
      this._save()
      return plan
    }
    return null
  }

  removeByGoodsId (userId, goodsId, ltuid = '') {
    const idx = this.plans.findIndex(p =>
      p.goodsId === String(goodsId) &&
      p.userId === String(userId) &&
      p.status === 'pending' &&
      (ltuid ? p.ltuid === String(ltuid) : true)
    )
    if (idx > -1) {
      const plan = this.plans[idx]
      this.plans.splice(idx, 1)
      this._save()
      return plan
    }
    return null
  }

  listUserPlans (userId) {
    return this.plans.filter(p => p.userId === String(userId))
  }

  listPendingPlans () {
    return this.plans.filter(p => p.status === 'pending' && p.exchangeTime > 0)
  }

  listPendingByLtuid (ltuid) {
    return this.plans.filter(p =>
      p.ltuid === String(ltuid) &&
      p.status === 'pending'
    )
  }

  hasPendingByGoodsId (userId, goodsId, ltuid) {
    return this.plans.some(p =>
      p.userId === String(userId) &&
      p.goodsId === String(goodsId) &&
      p.ltuid === String(ltuid) &&
      p.status === 'pending'
    )
  }

  updatePlan (planId, updates) {
    const plan = this.plans.find(p => p.id === planId)
    if (plan) {
      Object.assign(plan, updates)
      this._save()
      return plan
    }
    return null
  }

  getNextPending () {
    const pending = this.listPendingPlans()
      .filter(p => p.exchangeTime > Date.now() / 1000)
      .sort((a, b) => a.exchangeTime - b.exchangeTime)
    return pending[0] || null
  }
}

export default new ExchangePlanManager()
