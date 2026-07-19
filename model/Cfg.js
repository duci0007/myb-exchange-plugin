import fs from 'node:fs'
import YAML from 'yaml'
import _ from 'lodash'

const _path = process.cwd().replace(/\\/g, '/')
const Path = `${_path}/plugins/myb-exchange-plugin`

class Cfg {
  constructor () {
    this.config = {}
    this.defSet = {}
    this.configPath = `${Path}/config`
    this.defSetPath = `${Path}/config`
    this.dataPath = `${Path}/data`
  }

  init () {
    for (const dir of [this.configPath, this.dataPath]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    }
    const defFile = `${this.defSetPath}/config_default.yaml`
    const cfgFile = `${this.configPath}/config.yaml`
    if (!fs.existsSync(cfgFile) && fs.existsSync(defFile)) {
      fs.copyFileSync(defFile, cfgFile)
    }
  }

  getYaml (name, type = 'config') {
    const file = type === 'defSet'
      ? `${this.defSetPath}/config_default.yaml`
      : `${this.configPath}/${name}.yaml`
    const cacheKey = `${type}_${name}`
    if (this.config[cacheKey]) return this.config[cacheKey]
    try {
      const data = fs.readFileSync(file, 'utf8')
      this.config[cacheKey] = YAML.parse(data) || {}
      return this.config[cacheKey]
    } catch (e) {
      logger.error(`[兑换插件]读取配置 ${name}.yaml 失败: ${e.message}`)
      return {}
    }
  }

  setYaml (name, data, type = 'config') {
    const file = type === 'defSet'
      ? `${this.defSetPath}/config_default.yaml`
      : `${this.configPath}/${name}.yaml`
    const cacheKey = `${type}_${name}`
    try {
      fs.writeFileSync(file, YAML.stringify(data), 'utf8')
      delete this.config[cacheKey]
    } catch (e) {
      logger.error(`[兑换插件]写入配置 ${name}.yaml 失败: ${e.message}`)
      throw e
    }
  }

  get (key, defVal = undefined) {
    const config = this.getYaml('config')
    return _.get(config, key, defVal)
  }

  set (key, value) {
    const config = this.getYaml('config')
    _.set(config, key, value)
    this.setYaml('config', config)
  }

  getData (name) {
    const file = `${this.dataPath}/${name}`
    if (!fs.existsSync(file)) return {}
    try {
      const ext = name.split('.').pop()
      const data = fs.readFileSync(file, 'utf8')
      return ext === 'yaml' ? YAML.parse(data) : JSON.parse(data)
    } catch (e) {
      logger.error(`[兑换插件]读取数据 ${name} 失败: ${e.message}`)
      return {}
    }
  }

  setData (name, data) {
    const file = `${this.dataPath}/${name}`
    const ext = name.split('.').pop()
    const content = ext === 'yaml' ? YAML.stringify(data) : JSON.stringify(data, null, 2)
    try {
      fs.writeFileSync(file, content, 'utf8')
    } catch (e) {
      logger.error(`[兑换插件]写入数据 ${name} 失败: ${e.message}`)
      throw e
    }
  }
}

export default new Cfg()
