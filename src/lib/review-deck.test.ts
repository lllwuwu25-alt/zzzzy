import { expect, it } from 'vitest'
import { completeCard, skipCard, restoreCard } from './review-deck'
it('moves completed cards behind pending cards without reviewing them twice', () => {
  const result=completeCard({pending:['a','b'],completed:[]},'a')
  expect(result).toEqual({pending:['b'],completed:['a']})
  expect(completeCard(result,'b')).toEqual({pending:[],completed:['a','b']})
  expect(completeCard(result,'a')).toEqual(result)
})
it('skips without marking complete and restores a graded card to the front', () => {
  expect(skipCard({pending:['a','b'],completed:[]})).toEqual({pending:['b','a'],completed:[]})
  expect(restoreCard({pending:['b'],completed:['a']},'a')).toEqual({pending:['a','b'],completed:[]})
})
