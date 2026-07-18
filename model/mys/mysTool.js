import _ from 'lodash'
import md5 from 'md5'

const APP_VERSION = '2.70.1'

const salt = {
  k2: 'S9Hrn38d2b55PamfIR9BNA3Tx9sQTOem',
  lk2: 'sjdNFJB7XxyDWGIAk0eTV8AOCfMJmyEo',
  x4: 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs',
  x6: 't0qEgfub6cvueAPgR5m9aQWWVciEer7v',
  pass: 'JwYDpKvLj6MrMqqYU6jTKF17KNO2PXoS'
}

const api = {
  web: 'https://api-takumi.mihoyo.com',
  webNew: 'https://api-takumi.miyoushe.com',
  bbs: 'https://bbs-api.mihoyo.com',
  record: 'https://api-takumi-record.mihoyo.com',
  pass: 'https://passport-api.mihoyo.com',
  deviceFp: 'https://public-data-api.mihoyo.com/device-fp/api/getFp'
}

const goodsApi = {
  list: `${api.web}/mall/v1/web/goods/list`,
  detail: `${api.web}/mall/v1/web/goods/detail`,
  exchange: `${api.webNew}/mall/v1/web/goods/exchange`,
  address: `${api.web}/account/address/list`,
  balance: `${api.bbs}/apihub/sapi/getUserMissionsState`
}

const gameMap = {
  bh3: { name: '崩坏3', biz: 'bh3_cn', gids: 1 },
  hk4e: { name: '原神', biz: 'hk4e_cn', gids: 26 },
  bh2: { name: '崩坏2', biz: 'bh2_cn', gids: 30 },
  hkrpg: { name: '崩坏：星穹铁道', biz: 'hkrpg_cn', gids: 52 },
  nxx: { name: '未定事件簿', biz: 'nxx_cn', gids: 37 },
  nap: { name: '绝区零', biz: 'nap_cn', gids: 57 },
  bbs: { name: '米游社', biz: 'bbs_cn', gids: 34 }
}

function randomString (length, chars = 'abcdefghijklmnopqrstuvwxyz0123456789') {
  let str = ''
  for (let i = 0; i < length; i++) str += _.sample(chars)
  return str
}

function getDeviceGuid () {
  function S4 () {
    return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1)
  }
  return (S4() + S4() + '-' + S4() + '-' + S4() + '-' + S4() + '-' + S4() + S4() + S4())
}

function getDs (saltType = 'lk2', body = '', query = '') {
  const saltVal = salt[saltType] || salt.lk2
  const t = Math.floor(Date.now() / 1000)
  const r = _.random(100001, 200000)
  let ds = `salt=${saltVal}&t=${t}&r=${r}`
  if (body || query) ds += `&b=${body}&q=${query}`
  return `${t},${r},${md5(ds)}`
}

function getDsSign (saltType = 'k2') {
  const saltVal = salt[saltType] || salt.k2
  const t = Math.floor(Date.now() / 1000)
  const r = randomString(6)
  return `${t},${r},${md5(`salt=${saltVal}&t=${t}&r=${r}`)}`
}

export default {
  APP_VERSION,
  salt,
  api,
  goodsApi,
  gameMap,
  randomString,
  getDeviceGuid,
  getDs,
  getDsSign
}
