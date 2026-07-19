import fetch from 'node-fetch'
import mysTool from './mysTool.js'
import Cfg from '../Cfg.js'

const VERIFY_KEY = 'bll8iq97cem8'

export default class MysApi {
  constructor (cookie = '', deviceId = '', deviceFp = '') {
    this.cookie = cookie
    this.deviceId = deviceId || mysTool.getDeviceGuid()
    this.deviceFp = deviceFp || ''
  }

  async getFp (seedId) {
    const extFields = JSON.stringify({
      proxyStatus: '0',
      accelerometer: '-0.159515x-0.830887x-0.682495',
      ramCapacity: '3746',
      IDFV: this.deviceId.toUpperCase(),
      gyroscope: '-0.191951x-0.112927x0.632637',
      isJailBreak: '0',
      model: 'iPhone12,5',
      ramRemain: '115',
      chargeStatus: '1',
      networkType: 'WIFI',
      vendor: '--',
      osVersion: '17.0.2',
      batteryStatus: '50',
      screenSize: '414×896',
      cpuCores: '6',
      appMemory: '55',
      romCapacity: '488153',
      romRemain: '157348',
      cpuType: 'CPU_TYPE_ARM64',
      magnetometer: '-84.426331x-89.708435x-37.117889'
    })

    const body = JSON.stringify({
      seed_id: seedId || mysTool.randomString(16, '0123456789abcdef'),
      device_id: this.deviceId.toUpperCase(),
      platform: '1',
      seed_time: new Date().getTime() + '',
      ext_fields: extFields,
      app_name: 'bbs_cn',
      device_fp: '38d7ee834d1e9'
    })

    try {
      const timeoutMs = Cfg.get('exchange.timeout', 15) * 1000
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const res = await fetch(mysTool.api.deviceFp, {
        method: 'post',
        headers: {
          'Content-Type': 'application/json',
          'x-rpc-app_version': mysTool.APP_VERSION,
          'x-rpc-client_type': '1',
          'User-Agent': `Mozilla/5.0 (iPhone; CPU iPhone OS 14_0_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) miHoYoBBS/${mysTool.APP_VERSION}`
        },
        body,
        signal: controller.signal
      })
      clearTimeout(timer)
      const data = await res.json()
      if (data.retcode === 0 && data.data?.device_fp) {
        this.deviceFp = data.data.device_fp
        return this.deviceFp
      }
      return ''
    } catch (e) {
      clearTimeout(timer)
      logger.error(`[兑换插件]获取设备指纹失败: ${e.message}`)
      return ''
    }
  }

  getGoodListHeaders () {
    return {
      'Host': 'api-takumi.mihoyo.com',
      'Accept': 'application/json, text/plain, */*',
      'Origin': 'https://user.mihoyo.com',
      'Connection': 'keep-alive',
      'x-rpc-device_id': this.deviceId,
      'x-rpc-client_type': '5',
      'User-Agent': `Mozilla/5.0 (iPhone; CPU iPhone OS 14_0_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) miHoYoBBS/${mysTool.APP_VERSION}`,
      'Referer': 'https://user.mihoyo.com/',
      'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cookie': this.cookie
    }
  }

  getExchangeHeaders () {
    return {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
      'Connection': 'keep-alive',
      'Content-Type': 'application/json',
      'Host': 'api-takumi.miyoushe.com',
      'Origin': 'https://webstatic.miyoushe.com',
      'Referer': 'https://webstatic.miyoushe.com/',
      'User-Agent': `Mozilla/5.0 (iPhone; CPU iPhone OS 14_0_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) miHoYoBBS/${mysTool.APP_VERSION}`,
      'x-rpc-app_version': mysTool.APP_VERSION,
      'x-rpc-channel': 'appstore',
      'x-rpc-client_type': '1',
      'x-rpc-verify_key': VERIFY_KEY,
      'x-rpc-device_fp': this.deviceFp || '',
      'x-rpc-device_id': this.deviceId,
      'x-rpc-device_model': 'iPhone12,5',
      'x-rpc-device_name': mysTool.randomString(8),
      'x-rpc-sys_version': '17.0.2',
      'Cookie': this.cookie
    }
  }

  getAddressHeaders () {
    return {
      'Host': 'api-takumi.mihoyo.com',
      'Accept': 'application/json, text/plain, */*',
      'Origin': 'https://user.mihoyo.com',
      'Connection': 'keep-alive',
      'x-rpc-device_id': this.deviceId,
      'x-rpc-client_type': '5',
      'User-Agent': `Mozilla/5.0 (iPhone; CPU iPhone OS 14_0_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) miHoYoBBS/${mysTool.APP_VERSION}`,
      'Referer': 'https://user.mihoyo.com/',
      'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cookie': this.cookie
    }
  }

  async request (url, options = {}) {
    const timeoutMs = Cfg.get('exchange.timeout', 15) * 1000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal
      })
      clearTimeout(timer)
      const text = await res.text()
      let data
      try {
        data = JSON.parse(text)
      } catch (e) {
        if (text.startsWith('(')) {
          data = JSON.parse(text.replace(/\(|\)/g, ''))
        } else {
          throw e
        }
      }
      return data
    } catch (e) {
      clearTimeout(timer)
      logger.error(`[兑换插件]请求失败 ${url}: ${e.message}`)
      return { retcode: -1, message: e.message, error: true }
    }
  }

  async getGoodList (game = '', page = 1, pageSize = 20) {
    const url = `${mysTool.goodsApi.list}?app_id=1&point_sn=myb&page_size=${pageSize}&page=${page}&game=${game}`
    const res = await this.request(url, {
      method: 'get',
      headers: this.getGoodListHeaders()
    })
    return res
  }

  async getGoodDetail (goodsId) {
    const url = `${mysTool.goodsApi.detail}?app_id=1&point_sn=myb&goods_id=${goodsId}`
    const res = await this.request(url, {
      method: 'get',
      headers: this.getGoodListHeaders()
    })
    return res
  }

  async getAddress (t) {
    const url = `${mysTool.goodsApi.address}?t=${t}`
    const res = await this.request(url, {
      method: 'get',
      headers: this.getAddressHeaders()
    })
    return res
  }

  async getMybBalance (stokenData = null) {
    const url = mysTool.goodsApi.balance
    let cookie = this.cookie
    const dsSalt = 'k2'

    if (stokenData?.stoken && stokenData?.stuid) {
      const parts = []
      if (stokenData.stuid) parts.push(`stuid=${stokenData.stuid}`)
      if (stokenData.stoken) parts.push(`stoken=${stokenData.stoken}`)
      if (stokenData.mid) parts.push(`mid=${stokenData.mid}`)
      cookie = parts.join(';') + ';'
    }

    const res = await this.request(url, {
      method: 'get',
      headers: {
        'Cookie': cookie,
        'x-rpc-channel': 'miyousheluodi',
        'x-rpc-auto_test': 'true',
        'x-rpc-device_id': this.deviceId,
        'x-rpc-app_version': mysTool.APP_VERSION,
        'x-rpc-device_model': 'Mi 10',
        'x-rpc-device_name': 'Mi 10',
        'x-rpc-client_type': '2',
        'DS': mysTool.getDsSign(dsSalt),
        'Referer': 'https://app.mihoyo.com',
        'x-rpc-sys_version': '12',
        'Host': 'bbs-api.mihoyo.com',
        'User-Agent': 'okhttp/4.8.0'
      }
    })
    return res
  }

  async exchange (goodsId, addressId = '', uid = '', region = '', gameBiz = '') {
    const bodyObj = {
      app_id: 1,
      point_sn: 'myb',
      goods_id: String(goodsId),
      exchange_num: 1
    }
    if (addressId) bodyObj.address_id = String(addressId)
    if (uid) bodyObj.uid = String(uid)
    if (region) bodyObj.region = region
    if (gameBiz) bodyObj.game_biz = gameBiz

    const body = JSON.stringify(bodyObj)
    const url = mysTool.goodsApi.exchange

    const res = await this.request(url, {
      method: 'post',
      headers: this.getExchangeHeaders(),
      body
    })
    return res
  }

  /** 预热到兑换接口的 TCP/TLS 连接，减少首次请求耗时 */
  async warmup () {
    try {
      const url = new URL(mysTool.goodsApi.exchange)
      const dummyUrl = `https://${url.host}/`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3000)
      await fetch(dummyUrl, {
        method: 'HEAD',
        signal: controller.signal,
        headers: { 'Host': url.host }
      }).catch(() => {})
      clearTimeout(timer)
    } catch (e) {
      // 预热失败不影响后续流程
    }
  }
}
