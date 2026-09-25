import { forwardRef, useImperativeHandle, useMemo, useState } from 'react'

import PlatformChips from '@/components/home/PlatformChips'
import songlistState, { type Source } from '@/store/songlist/state'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'

export interface SourceChipsProps {
  onSourceChange: (source: Source) => void
}

export interface SourceChipsType {
  setSource: (source: Source) => void
}

// 平台切换胶囊组：替代原来的右侧下拉选择器，与推荐页（Discovery）的平台切换按钮
// 同一样式（PlatformChips），一次点击直接切换歌单/排行榜的数据平台。
// 平台文案沿用全局设置 source_${sourceNameType}_${source}（默认 alias，如「小蜗音乐」）。
export default forwardRef<SourceChipsType, SourceChipsProps>(({ onSourceChange }, ref) => {
  const [source, setSourceState] = useState<Source>('kw')
  const sourceNameType = useSettingValue('common.sourceNameType')
  const t = useI18n()

  useImperativeHandle(ref, () => ({
    setSource(nextSource) {
      setSourceState(nextSource)
    },
  }))

  const options = useMemo(
    () => songlistState.sources.map((s) => ({
      id: s as string,
      label: t(`source_${sourceNameType}_${s}` as any),
    })),
    [sourceNameType, t],
  )

  return (
    <PlatformChips
      options={options}
      selectedId={source}
      noInset
      onChange={(id) => {
        const nextSource = id as Source
        setSourceState(nextSource)
        onSourceChange(nextSource)
      }}
    />
  )
})
