export const GAME_MAP = {
  '原神': 'hk4e', 'ys': 'hk4e',
  '崩坏3': 'bh3', '崩3': 'bh3', 'bh3': 'bh3',
  '崩坏：星穹铁道': 'hkrpg', '星铁': 'hkrpg', '崩铁': 'hkrpg', '星穹铁道': 'hkrpg', 'xq': 'hkrpg',
  '未定事件簿': 'nxx', '未定': 'nxx', 'wd': 'nxx',
  '绝区零': 'nap', 'zzz': 'nap',
  '米游社': 'bbs', '综合': 'bbs', 'bbs': 'bbs',
  '崩坏2': 'bh2', '崩2': 'bh2', 'bh2': 'bh2'
}

export const GAME_BIZ_MAP = {
  hk4e_cn: 'gs', hk4e: 'gs',
  hkrpg_cn: 'sr', hkrpg: 'sr',
  bh3_cn: 'bh3', bh3: 'bh3',
  bh2_cn: 'bh2', bh2: 'bh2',
  nxx_cn: 'nxx', nxx: 'nxx',
  nap_cn: 'nap', nap: 'nap'
}

export const GAME_LABELS = {
  gs: '原神', sr: '星铁', bh3: '崩坏3',
  bh2: '崩坏2', nxx: '未定', nap: '绝区零'
}

export function mapGameBizToKey (gameBiz) {
  if (!gameBiz) return ''
  return GAME_BIZ_MAP[gameBiz] || ''
}

export function gameLabel (gameKey) {
  return GAME_LABELS[gameKey] || '游戏'
}
