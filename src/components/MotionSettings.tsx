import { useState } from 'react'
import { getMotionPreference, setMotionPreference, type MotionPreference } from '../lib/preferences'
export function MotionSettings() {
  const [value, setValue] = useState(getMotionPreference)
  return <label className="field"><span>界面动效</span><select value={value} onChange={(e) => { const v = e.target.value as MotionPreference; setValue(v); setMotionPreference(v) }}><option value="system">跟随系统</option><option value="reduced">减少动效</option></select><small>减少模式将简化位移和过渡，所有功能仍可使用。</small></label>
}
