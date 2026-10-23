import {useEffect,useRef} from 'react'
import {migrateImage,renderImageAsset} from '../lib/annotations'
import type {ImageAsset,Mistake,QuestionDiagram} from '../types'
import './question-diagrams.css'
function DiagramCanvas({image,diagram,masked}:{image:ImageAsset;diagram:QuestionDiagram;masked:boolean}) {
 const canvas=useRef<HTMLCanvasElement>(null)
 useEffect(()=>{let active=true;const source=new Image();source.onload=()=>{
  const context=canvas.current?.getContext('2d');if(!active||!context)return
  const asset=migrateImage(image,source.naturalWidth,source.naturalHeight)
  renderImageAsset(context,{...asset,rotation:0,crop:{x:diagram.x*source.naturalWidth/1000,y:diagram.y*source.naturalHeight/1000,width:diagram.width*source.naturalWidth/1000,height:diagram.height*source.naturalHeight/1000}},source,{showMasks:masked})
 };source.src=image.dataUrl;return()=>{active=false}},[image,diagram,masked])
 return <canvas ref={canvas} role="img" aria-label={diagram.caption||'题目配图'}/>
}
export function QuestionDiagrams({item,masked=true,onChange}:{item:Pick<Mistake,'images'|'diagrams'>;masked?:boolean;onChange?:(diagrams:QuestionDiagram[])=>void}) {
 const diagrams=item.diagrams??[]
 if(!diagrams.length&&!onChange)return null
 const patch=(index:number,values:Partial<QuestionDiagram>)=>onChange?.(diagrams.map((d,i)=>i===index?{...d,...values}:d))
 return <section className="question-diagrams" aria-label="题目配图">{diagrams.map((d,index)=>{
  const image=item.images.find((image)=>image.id===d.imageId)
  return <figure key={`${d.imageId}-${index}`}><div className="diagram-preview">{image?<DiagramCanvas image={image} diagram={d} masked={masked}/>:<p>配图原图缺失，请重新添加图片。</p>}</div><figcaption>{d.caption||`配图 ${index+1}`}</figcaption>{onChange&&<div className="diagram-edit-controls"><details><summary>调整配图范围</summary>{(['x','y','width','height']as const).map((key)=><label key={key}><span>{{x:'左侧位置',y:'顶部位置',width:'宽度',height:'高度'}[key]}</span><input type="range" aria-label={`配图${index+1}${key}`} min={key==='width'||key==='height'?1:0} max={key==='x'?1000-d.width:key==='y'?1000-d.height:key==='width'?1000-d.x:1000-d.y} value={d[key]} onChange={(e)=>patch(index,{[key]:Number(e.target.value)})}/><small>{Math.round(d[key]/10)}%</small></label>)}<button className="button compact ghost" onClick={()=>patch(index,{x:0,y:0,width:1000,height:1000})}>使用完整原图</button></details><button className="button ghost compact" onClick={()=>onChange(diagrams.filter((_,i)=>i!==index))}>移除配图</button></div>}</figure>
 })}{onChange&&item.images.length>0&&diagrams.length<12&&<label className="diagram-add"><span>补充题目配图</span><select aria-label="从原图添加配图" value="" onChange={(e)=>{const imageId=e.target.value;if(imageId)onChange([...diagrams,{imageId,x:0,y:0,width:1000,height:1000,caption:'题目配图'}])}}><option value="">选择原图，添加后可调整范围</option>{item.images.map((image,i)=><option key={image.id} value={image.id}>第 {i+1} 张 · {image.name}</option>)}</select></label>}</section>
}
