import { readStorage, removeStorage, writeStorage } from './utils/storage'

export type AuthUser = {
  id: string
  name: string
  email: string
}

type SignInInput = { email:string; password:string }
type SignUpInput = SignInInput & { name:string }

const sessionKey = 'moa-auth-user'

const saveUser = (user:AuthUser) => {
  writeStorage('session', sessionKey, JSON.stringify(user))
  return user
}

export function readAuthUser():AuthUser | null {
  try {
    const saved = JSON.parse(readStorage('session', sessionKey) || 'null') as Partial<AuthUser> | null
    return saved && typeof saved.id === 'string' && typeof saved.name === 'string' && typeof saved.email === 'string' ? saved as AuthUser : null
  } catch { return null }
}

export function clearAuthUser() {
  removeStorage('session', sessionKey)
}

async function submitAuth(path:string,input:SignInInput | SignUpInput):Promise<AuthUser> {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/,'')
  if (!apiBaseUrl) {
    const name = 'name' in input ? input.name.trim() : input.email.split('@')[0]
    return saveUser({id:`local-${crypto.randomUUID()}`,name,email:input.email.trim().toLowerCase()})
  }

  const response = await fetch(`${apiBaseUrl}${path}`,{
    method:'POST',
    credentials:'include',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(input),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as {message?:string} | null
    throw new Error(body?.message || (response.status === 401 ? '이메일이나 비밀번호를 확인해주세요.' : '요청을 처리하지 못했어요.'))
  }
  const body = await response.json() as AuthUser | {user:AuthUser}
  return saveUser('user' in body ? body.user : body)
}

export const signIn = (input:SignInInput) => submitAuth('/api/auth/login',input)
export const signUp = (input:SignUpInput) => submitAuth('/api/auth/signup',input)
