import { describe, expect, it } from 'vitest'
import { claudeHint, plainApiError } from '../backend/lib/llm'

const raw = '400 {"type":"error","error":{"type":"invalid_request_error","message":"This API key is not scoped to a workspace. Set the anthropic-workspace-id header."}}'

describe('API error text', () => {
  it('unwraps SDK JSON errors', () => {
    expect(plainApiError(raw)).toBe('400: This API key is not scoped to a workspace. Set the anthropic-workspace-id header.')
    expect(plainApiError(`Claude 400: ${raw}`)).toBe('Claude 400: This API key is not scoped to a workspace. Set the anthropic-workspace-id header.')
    expect(plainApiError('plain text')).toBe('plain text')
  })
  it('puts the fix first', () => {
    expect(claudeHint(raw)).toMatch(/^Claude key belongs to the whole organisation — paste a Workspace ID/)
    expect(claudeHint('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}')).toMatch(/^Claude key is wrong or was deleted/)
    expect(claudeHint('400 {"type":"error","error":{"message":"Your credit balance is too low"}}')).toMatch(/^Claude account has no credit/)
  })
})
