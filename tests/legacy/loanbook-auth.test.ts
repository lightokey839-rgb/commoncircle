import { describe,it,expect,vi,beforeEach } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { type WalletClient } from 'viem'
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { authenticateWallet,buildSignInMessage,verifiedWallet,restoreSession } from '../../src/lib/auth'
const holder=vi.hoisted(()=>({client:null as unknown}))
vi.mock('../../src/lib/supabase',()=>({getSupabaseClient:()=>holder.client}))
// Deterministic PUBLIC TEST-ONLY keys. Never funded or used outside local mocks.
const alice=privateKeyToAccount(('0x'+'11'.repeat(32)) as `0x${string}`)
const bob=privateKeyToAccount(('0x'+'22'.repeat(32)) as `0x${string}`)
const identity=(address:string)=>({id:'alice',identities:[{provider:'web3',identity_data:{custom_claims:{address,chain:'ethereum'}}}]})
function setup(){
 const auth={signInWithWeb3:vi.fn(async()=>({data:{session:{},user:identity(alice.address)},error:null})),signOut:vi.fn(async()=>({error:null})),
 getSession:vi.fn(async()=>({data:{session:{user:identity(alice.address)}},error:null})),
 getUser:vi.fn(async()=>({data:{user:identity(alice.address)},error:null}))}
 const wallet={account:{address:alice.address,type:'json-rpc' as const},getAddresses:vi.fn(async()=>[alice.address]),getChainId:vi.fn(async()=>5042002),
  signMessage:vi.fn(async(args:{account:string;message:string})=>{
   expect(args.account).toBe(alice.address)
   expect(validateSiweMessage({message:parseSiweMessage(args.message),domain:'loanbook.example',address:alice.address})).toBe(true)
   return alice.signMessage({message:args.message})
  })}
 return {client:{auth} as unknown as SupabaseClient,auth,wallet,walletClient:wallet as unknown as WalletClient}
}
describe('SIWE authentication',()=>{
 beforeEach(()=>{holder.client=null})
 it('builds valid EIP-4361 messages with unique secure nonces and expiry for both Arc chains',()=>{
  for(const chainId of [5042,5042002]){
   const a=parseSiweMessage(buildSignInMessage(alice.address,chainId,'https://loanbook.example'))
   const b=parseSiweMessage(buildSignInMessage(alice.address,chainId,'https://loanbook.example'))
   expect(a.nonce).toMatch(/^[a-f0-9]{32}$/);expect(a.nonce).not.toBe(b.nonce)
   expect(a.address).toBe(alice.address);expect(a.chainId).toBe(chainId);expect(a.uri).toBe('https://loanbook.example/')
   expect(validateSiweMessage({message:a,domain:'loanbook.example',address:alice.address})).toBe(true)
  }
 })
 it('rejects unsupported chains and insecure origins',()=>{
  expect(()=>buildSignInMessage(alice.address,1,'https://loanbook.example')).toThrow()
  expect(()=>buildSignInMessage(alice.address,5042,'http://example.com')).toThrow()
 })
 it('rejects IP-literal local origins that Supabase SIWE does not accept',()=>{
  expect(()=>buildSignInMessage(alice.address,5042002,'http://127.0.0.1:5174')).toThrow('localhost')
  expect(()=>buildSignInMessage(alice.address,5042002,'http://localhost:5173')).not.toThrow()
 })
 it('authenticates a real cryptographic signature through native Supabase API',async()=>{
  const {client,auth,walletClient}=setup()
  const result=await authenticateWallet(client,alice.address,walletClient,'https://loanbook.example')
  expect(result.wallet).toBe(alice.address.toLowerCase());expect(auth.signInWithWeb3).toHaveBeenCalledOnce()
 })
 it('rejects account mismatch before signing',async()=>{
  const {client,walletClient,wallet}=setup()
  await expect(authenticateWallet(client,bob.address,walletClient,'https://loanbook.example')).rejects.toThrow('Wallet changed')
  expect(wallet.signMessage).not.toHaveBeenCalled()
 })
 it('rejects wallet switching during signing',async()=>{
  const {client,walletClient,wallet,auth}=setup()
  wallet.getAddresses.mockResolvedValueOnce([alice.address]).mockResolvedValueOnce([bob.address])
  await expect(authenticateWallet(client,alice.address,walletClient,'https://loanbook.example')).rejects.toThrow('Wallet changed')
  expect(auth.signInWithWeb3).not.toHaveBeenCalled()
 })
 it('rejects wrong signatures',async()=>{
  const {client,walletClient,wallet}=setup()
  wallet.signMessage.mockImplementation(async args=>bob.signMessage({message:args.message}))
  await expect(authenticateWallet(client,alice.address,walletClient,'https://loanbook.example')).rejects.toThrow('Signature does not match')
 })
 it('handles rejected signatures',async()=>{
  const {client,walletClient,wallet}=setup();wallet.signMessage.mockRejectedValue({code:4001})
  await expect(authenticateWallet(client,alice.address,walletClient,'https://loanbook.example')).rejects.toThrow('cancelled')
 })
 it('propagates server rejection of invalid messages',async()=>{
  const {client,walletClient,auth}=setup()
  auth.signInWithWeb3.mockResolvedValue({data:{session:null,user:null},error:{message:'Invalid SIWE message'}} as never)
  await expect(authenticateWallet(client,alice.address,walletClient,'https://loanbook.example')).rejects.toThrow('Invalid SIWE')
 })
 it('explains a Supabase redirect allowlist rejection',async()=>{
  const {client,walletClient,auth}=setup()
  auth.signInWithWeb3.mockResolvedValue({data:{session:null,user:null},error:{message:'Signed Ethereum message is using URI which is not allowed on this server, message was signed for another app'}} as never)
  await expect(authenticateWallet(client,alice.address,walletClient,'https://loanbook.example/app/')).rejects.toThrow('https://loanbook.example/app/')
 })
 it('rejects missing or mismatched verified identities',async()=>{
  const {client,walletClient,auth}=setup()
  auth.signInWithWeb3.mockResolvedValue({data:{session:{},user:identity(bob.address)},error:null})
  await expect(authenticateWallet(client,alice.address,walletClient,'https://loanbook.example')).rejects.toThrow('mismatch')
  expect(auth.signOut).toHaveBeenCalled()
  expect(verifiedWallet({identities:[],user_metadata:{wallet:alice.address}} as never)).toBeNull()
 })
 it('clears an expired server session',async()=>{
  const {client,auth}=setup();holder.client=client
  auth.getUser.mockResolvedValue({data:{user:null},error:{message:'expired'}} as never)
  expect(await restoreSession(alice.address)).toBeNull();expect(auth.signOut).toHaveBeenCalled()
 })
 it('restores only the expected verified wallet',async()=>{
  const {client,auth}=setup();holder.client=client
  expect((await restoreSession(alice.address))?.wallet).toBe(alice.address.toLowerCase())
  expect(await restoreSession(bob.address)).toBeNull();expect(auth.signOut).toHaveBeenCalled()
 })
})

