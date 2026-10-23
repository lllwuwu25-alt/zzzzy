import type {ImageAsset} from '../../types'
import type {AiQuestionDraft} from './schema'
export function attachFigures(draft:AiQuestionDraft,images:ImageAsset[]):AiQuestionDraft {
  if(!draft.figures?.length)return draft
  return {...draft,diagrams:draft.figures.map((f)=>{
    const image=images[f.imageIndex-1]
    if(!image)throw new Error('AI 返回的配图来源不匹配，请重试或手动标记配图。')
    return {imageId:image.id,x:f.bbox[0],y:f.bbox[1],width:f.bbox[2],height:f.bbox[3],caption:f.caption}
  })}
}
