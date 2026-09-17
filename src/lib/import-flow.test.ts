import { describe, expect, it } from 'vitest'
import type { ImageAsset } from '../types'
import { assignGroupType, groupsFor, importReady } from './import-flow'

const image = (id: string): ImageAsset => ({
  id, name: `${id}.png`, dataUrl: 'data:image/png;base64,AA==', rotation: 0, annotations: [],
})

describe('capture import grouping', () => {
  it('merges images into one ordered group', () => {
    const groups = groupsFor([image('a'), image('b')], 'merge')
    expect(groups).toHaveLength(1)
    expect(groups[0].images.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('splits images into ordered groups', () => {
    const groups = groupsFor([image('a'), image('b')], 'split')
    expect(groups.map((group) => group.images[0].id)).toEqual(['a', 'b'])
  })

  it('becomes ready only after every group has a type', () => {
    const groups = groupsFor([image('a'), image('b')], 'split')
    expect(importReady(groups)).toBe(false)
    const first = assignGroupType(groups, groups[0].id, 'choice')
    expect(importReady(first)).toBe(false)
    const complete = assignGroupType(first, first[1].id, 'fill-blank')
    expect(importReady(complete)).toBe(true)
  })

  it('does not mutate the existing groups when assigning a type', () => {
    const groups = groupsFor([image('a')], 'merge')
    const next = assignGroupType(groups, groups[0].id, 'short-answer')
    expect(groups[0].questionType).toBeUndefined()
    expect(next[0].questionType).toBe('short-answer')
  })
})
