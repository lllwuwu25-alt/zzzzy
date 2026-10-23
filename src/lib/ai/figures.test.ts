import {expect,it} from 'vitest'
import {parseAiQuestion} from './schema'
import {attachFigures} from './figures'
import type {ImageAsset} from '../../types'
const base={questionType:'short-answer',question:'如图，在正方体中…',answer:'',shortAnswer:{keyPoints:[]}}
it('maps figure bounds to the correct selected original image without copying its data',()=>{
 const draft=parseAiQuestion(JSON.stringify({...base,figures:[{imageIndex:1,bbox:[40,180,240,360],caption:'正方体示意图'}]}),'short-answer')
 const images=[{id:'original-2',dataUrl:'original'}] as ImageAsset[]
 const result=attachFigures(draft,images)
 expect(result.diagrams).toEqual([{imageId:'original-2',x:40,y:180,width:240,height:360,caption:'正方体示意图'}])
 expect(images[0].dataUrl).toBe('original')
})
it('rejects out-of-image bounds and unrecognised image references',()=>{
 for(const bbox of [[-1,0,200,200],[900,0,200,100],[0,0,0,200],[0,0,'100',200]])expect(()=>parseAiQuestion(JSON.stringify({...base,figures:[{imageIndex:1,bbox,caption:''}]}),'short-answer')).toThrow()
 const draft=parseAiQuestion(JSON.stringify({...base,figures:[{imageIndex:2,bbox:[0,0,100,100],caption:''}]}),'short-answer')
 expect(()=>attachFigures(draft,[{id:'a'}] as ImageAsset[])).toThrow()
})
