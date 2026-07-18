export class Help extends plugin {
  constructor () {
    super({
      name: '米游币兑换:帮助',
      dsc: '米游币兑换插件帮助菜单',
      event: 'message',
      priority: 50,
      rule: [
        { reg: '^#?(米游币兑换)?(帮助|菜单|help|说明|功能|指令)$', fnc: 'help', permission: 'all' },
        { reg: '^#米游币兑换$', fnc: 'help', permission: 'all' }
      ]
    })
  }

  static HELP_LIST = [
    { title: '#米游币商品 [类别]', desc: '查看可兑换商品（图片列表，带序号）' },
    { title: '#米游币兑换<类别><序号>', desc: '快捷添加，例如 #米游币兑换原神1' },
    { title: '#兑换计划删除<序号>', desc: '按列表序号删除兑换计划' },
    { title: '#兑换计划', desc: '查看我的兑换计划列表' },
    { title: '#米游币查询', desc: '查询当前账号的米游币余额' },
    { title: '#米游币地址', desc: '设置/查看收货地址' }
  ]

  static CAT_LIST = [
    { name: '原神', key: 'hk4e' },
    { name: '崩坏3', key: 'bh3' },
    { name: '星铁', key: 'hkrpg' },
    { name: '未定', key: 'nxx' },
    { name: '绝区零', key: 'nap' },
    { name: '米游社', key: 'bbs' }
  ]

  async help () {
    const e = this.e
    if (!e.runtime) {
      await this.reply('❌ 未找到 runtime，请升级至最新版 Yunzai', true)
      return false
    }
    try {
      await e.runtime.render('myb-exchange-plugin', 'help/index', {
        helpList: Help.HELP_LIST,
        catList: Help.CAT_LIST,
        saveId: 'index'
      })
    } catch (err) {
      logger.error(`[兑换插件]帮助图片渲染失败: ${err.message}`)
      await this.reply('❌ 帮助图片渲染失败，请检查 puppeteer 是否可用', true)
    }
    return false
  }
}
