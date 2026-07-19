import fs from 'node:fs'
import Cfg from './model/Cfg.js'
import Scheduler from './model/scheduler.js'
import HealthCheck from './model/healthCheck.js'

if (!global.segment) { global.segment = (await import('oicq')).segment }

Cfg.init()

let apps = {}

const files = fs.readdirSync('./plugins/myb-exchange-plugin/apps').filter(file => file.endsWith('.js'))

let ret = []
files.forEach((file) => {
  ret.push(import(`./apps/${file}`))
})

ret = await Promise.allSettled(ret)

for (let i = 0; i < files.length; i++) {
  let name = files[i].replace('.js', '')
  if (ret[i].status !== 'fulfilled') {
    logger.error(`[兑换插件]载入插件错误：${name}`)
    logger.error(ret[i].reason)
    continue
  }
  apps[name] = ret[i].value[Object.keys(ret[i].value)[0]]
}

export { apps }

setTimeout(() => {
  Scheduler.init()
  HealthCheck.init()
  logger.mark('--------- ∠( ᐛ 」∠)＿ 米游币兑换插件加载完成 ---------')
}, 1000)
