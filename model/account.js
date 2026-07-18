import cfg from '../../../lib/config/config.js'
import fs from 'fs'
import path from 'path'
import YAML from 'yaml'

/**
 * 账号凭据读取 - 使用 Yunzai 本体的 NoteUser/MysUser 机制
 *
 * 关键概念：
 *   NoteUser：以 QQ 号为主键，一个用户可绑定多个 MysUser（米游社账号）
 *   MysUser：以 ltuid 为主键，存储 CK 和绑定的游戏 UID
 *   多账号切换：通过 setMainUid(uid, game) 设置当前游戏的主 UID
 *
 * 默认用户：Yunzai 本体配置的 master（other.yaml 中的 masterQQ）
 */
class Account {
  constructor () {
    this.NoteUser = null
  }

  /** 懒加载 Yunzai 本体的 NoteUser */
  async _loadModels () {
    if (this.NoteUser) return
    try {
      const { default: NU } = await import('../../../plugins/genshin/model/mys/NoteUser.js')
      this.NoteUser = NU
    } catch (e) {
      logger.error(`[兑换插件]加载 NoteUser 失败: ${e.message}`)
      throw e
    }
  }

  _getUserId (userId) {
    if (userId) return String(userId)
    return this.getDefaultUserId()
  }

  /** 获取默认用户 ID（Yunzai 本体配置的第一个 master QQ） */
  getDefaultUserId () {
    const masterQQ = cfg.masterQQ
    return masterQQ?.[0] ? String(masterQQ[0]) : 'stdin'
  }

  /** 创建 NoteUser 实例（统一入口，消除重复代码） */
  async _getNoteUser (userId) {
    userId = this._getUserId(userId)
    if (!this.NoteUser) await this._loadModels()
    try {
      if (userId === 'stdin') {
        return await this.NoteUser.create(userId)
      }
      // 正常用户构造一个模拟的 e 对象
      const mockE = { user_id: userId, originalUserId: userId }
      return await this.NoteUser.create(mockE)
    } catch (e) {
      logger.error(`[兑换插件]创建 NoteUser 失败: ${e.message}`)
      return null
    }
  }

  /**
   * 获取用户的账号凭据（当前选中账号）
   * @param {string} userId QQ 号或 stdin
   * @param {string} game 游戏类型：gs/sr/zzz/bh3/nxx，默认 gs
   * @returns {Promise<{cookie:string, ltuid:string, device:string, uids:Object, uid:string} | null>}
   */
  async get (userId, game = 'gs') {
    const noteUser = await this._getNoteUser(userId)
    if (!noteUser || !noteUser.hasCk) return null

    // 获取当前游戏的主 UID
    let uid = noteUser.getUid(game)
    if (!uid) {
      // 当前游戏没有主 UID，取第一个绑定了 CK 的 UID
      const ckUids = noteUser.getCkUidList(game)
      if (!ckUids.length) return null
      uid = ckUids[0].uid
      // 自动设置为主 UID，避免下次又取不到
      noteUser.setMainUid(uid, game)
    }

    // 获取当前账号的 MysUser 对象
    const mysUser = noteUser.getMysUser(game)
    if (!mysUser) {
      logger.warn(`[兑换插件]未找到 MysUser: userId=${userId}, game=${game}, uid=${uid}`)
      return null
    }

    const ckInfo = mysUser.getCkInfo(game) || {}

    return {
      cookie: mysUser.ck || ckInfo.ck || '',
      ltuid: String(mysUser.ltuid || ckInfo.ltuid || ''),
      device: mysUser.device || '',
      uids: mysUser.uids || {},
      uid: String(uid)
    }
  }

  /**
   * 获取用户绑定的所有游戏角色 UID
   * @param {string} userId QQ 号或 stdin
   * @returns {Promise<Array<{game:string, uid:string, region:string, nickname:string, ltuid:string}>>}
   */
  async listGameUids (userId) {
    const noteUser = await this._getNoteUser(userId)
    if (!noteUser || !noteUser.hasCk) return []

    const games = ['gs', 'sr', 'zzz', 'bh3', 'nxx']
    const result = []

    for (const game of games) {
      const uidList = noteUser.getUidList(game)
      for (const item of uidList) {
        if (item?.uid && item.uid !== 'undefined') {
          result.push({
            game,
            uid: String(item.uid),
            region: item.region || '',
            nickname: item.nickname || '',
            ltuid: String(item.ltuid || '')
          })
        }
      }
    }

    return result
  }

  /**
   * 获取用户绑定的所有米游社账号列表
   * @param {string} userId QQ 号或 stdin
   * @returns {Promise<Array<{ltuid:string, ck:string, uids:Object}>>}
   */
  async listAccounts (userId) {
    const noteUser = await this._getNoteUser(userId)
    if (!noteUser || !noteUser.hasCk) return []

    const result = []
    for (const [ltuid, mysUser] of Object.entries(noteUser.mysUsers)) {
      if (mysUser && mysUser.ck) {
        result.push({
          ltuid: String(ltuid),
          ck: mysUser.ck,
          uids: mysUser.uids || {}
        })
      }
    }

    return result
  }

  /**
   * 通过游戏 UID 获取对应的 CK（用于多账号场景）
   * @param {string} userId QQ 号或 stdin
   * @param {string} uid 游戏 UID
   * @param {string} game 游戏类型
   * @returns {Promise<{cookie:string, ltuid:string, device:string} | null>}
   */
  async getByUid (userId, uid, game = 'gs') {
    const noteUser = await this._getNoteUser(userId)
    if (!noteUser) return null

    const uidData = noteUser.getUidData(uid, game)
    if (!uidData || !uidData.ltuid) return null

    const mysUser = noteUser.mysUsers[uidData.ltuid]
    if (!mysUser || !mysUser.ck) return null

    return {
      cookie: mysUser.ck,
      ltuid: String(mysUser.ltuid),
      device: mysUser.device || ''
    }
  }

  /**
   * 设置当前游戏的主 UID（切换账号）
   * @param {string} userId QQ 号或 stdin
   * @param {string} uid 游戏 UID
   * @param {string} game 游戏类型
   * @returns {Promise<boolean>}
   */
  async setMainUid (userId, uid, game = 'gs') {
    const noteUser = await this._getNoteUser(userId)
    if (!noteUser) return false
    return !!noteUser.setMainUid(uid, game)
  }

  /**
   * 从 xiaoyao-cvs-plugin 的 yaml 文件中获取指定 ltuid 的 stoken
   * @param {string} userId QQ 号或 stdin
   * @param {string} ltuid 米游社账号 ltuid
   * @returns {Promise<{stuid:string, stoken:string, mid:string} | null>}
   */
  async getStokenByLtuid (userId, ltuid) {
    userId = this._getUserId(userId)
    ltuid = String(ltuid)
    const stokenDir = 'plugins/xiaoyao-cvs-plugin/data/yaml'
    const yamlPath = path.join(process.cwd(), stokenDir, `${userId}.yaml`)

    try {
      if (!fs.existsSync(yamlPath)) return null
      const data = YAML.parse(fs.readFileSync(yamlPath, 'utf-8')) || {}
      for (const uidKey of Object.keys(data)) {
        const item = data[uidKey]
        if (item && String(item.stuid) === ltuid && item.stoken) {
          return {
            stuid: String(item.stuid),
            stoken: item.stoken,
            mid: item.mid || ''
          }
        }
      }
      return null
    } catch (e) {
      logger.warn(`[兑换插件]读取 stoken 失败: ${e.message}`)
      return null
    }
  }
}

export default new Account()
