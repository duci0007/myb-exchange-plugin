# myb-exchange-plugin

米游币自动兑换插件，适用于 [TRSS-Yunzai](https://gitee.com/TimeRainStarSky/Yunzai)。

支持米游社商城限时商品的自动抢兑、兑换计划管理、余额查询等功能。

## 安装

将本插件放置在 Yunzai 的 `plugins` 目录下：

```bash
# 进入 Yunzai 根目录
cd Yunzai

# 克隆仓库到 plugins 目录
git clone https://github.com/duci0007/myb-exchange-plugin.git ./plugins/myb-exchange-plugin
```

**无需额外安装依赖**，所需 npm 包（`lodash`、`yaml`、`md5`、`node-fetch`、`oicq`）均由 Yunzai 主项目提供。

## 使用方法

### 前置准备

1. 配合 [xiaoyao-cvs-plugin](https://github.com/Ctrlcvs/xiaoyao-cvs-plugin) 插件使用，使用米游币查询功能须先 `#扫码登陆`
2. 使用其他功能必须有 cookie
3. 通过 本体的`#uid`功能设置各游戏的主 UID（用于虚拟商品接收）

### 命令列表

| 命令 | 说明 |
| --- | --- |
| `#米游币商品 [类别]` | 查看可兑换商品（图片列表，带序号） |
| `#米游币兑换<类别><序号>` | 快捷添加兑换计划，例如 `#米游币兑换原神1` |
| `#兑换计划删除<序号>` | 按列表序号删除兑换计划 |
| `#兑换计划` | 查看我的兑换计划列表（图片输出，按账号分组） |
| `#米游币查询` | 查询当前账号的米游币余额 |
| `#米游币地址` | 设置/查看收货地址（实物商品） |
| `#米游币兑换帮助` | 查看帮助菜单 |


## 常见问题

### 添加计划时提示"查询余额失败，跳过余额检查"

未安装 xiaoyao-cvs-plugin，或该插件未保存 stoken。请先执行 `#扫码登陆` 以生成 stoken。
不影响兑换功能，将按添加顺序进行兑换。

### 提示"该账号已添加过该商品的兑换计划"

同一米游社账号（同一 `ltuid`）对同一商品只允许存在一个待兑换计划。如需重新添加，请先用 `#兑换计划删除<序号>` 删除原计划。

### 商品列表为空

确认目标商品是否为限时商品。插件仅展示 `unlimit === false` 且有 `next_time` 的限时商品。

## 关于

本插件不内置过码功能，进行兑换任务时有概率遇到验证码，请自行寻找过码工具。

## 联系方式

QQ：2635221375

## 免责声明

功能仅限内部交流与小范围使用，严禁将本插件用于任何商业用途或盈利。

图片与其他素材均来自于网络，仅供交流学习使用，如有侵权请联系，会立即删除。

## 参考致谢


- [Yunzai-Bot](https://github.com/Le-niao/Yunzai-Bot) - 乐神原版Yunzai
- [TRSS-Yunzai](https://github.com/TimeRainStarSky/Yunzai) - Yunzai TRSS分支
- [miao-plugin](https://github.com/yoimiya-kokomi/miao-plugin) - 喵喵插件
- [xiaoyao-cvs-plugin](https://github.com/Ctrlcvs/xiaoyao-cvs-plugin) - 原神星铁图鉴插件，stoken相关功能支持
- [nonebot-plugin-mystool](https://github.com/Ljzd-PRO/nonebot-plugin-mystool) -  NoneBot2机器人的米游社兑换插件，本插件的主要参考插件