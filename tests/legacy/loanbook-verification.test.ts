import {it,expect} from 'vitest'
import {verifyLoanTerms,verifiedStatus} from '../../src/lib/loan-verification'
import {inviteCode} from '../../src/lib/invites'
const borrower='0x'+'aa'.repeat(20),lender='0x'+'bb'.repeat(20)
const request={borrower,selected_lender:lender,amount_usdc:'0.010001',duration_days:7}
const loan={borrower:borrower as `0x${string}`,lender:lender as `0x${string}`,amount:10001n,duration:604800n,state:0,dueDate:0n}
it('checks exact six-decimal amount, duration and both wallets',()=>{
 expect(()=>verifyLoanTerms(request,loan)).not.toThrow()
 for(const bad of [{amount:10000n},{duration:1n},{borrower:lender},{lender:borrower}]){
  expect(()=>verifyLoanTerms(request,{...loan,...bad} as typeof loan)).toThrow()
 }
})
it('accepts only known contract states',()=>{expect([0,1,2,3].map(verifiedStatus)).toEqual(['lender_selected','funded','repaid','cancelled']);expect(()=>verifiedStatus(4)).toThrow()})
it('round-trips invitation codes including base64 characters',()=>{
 expect(inviteCode('https://loanbook.example/#invite='+encodeURIComponent('abc+/xyz=='))).toBe('abc+/xyz==')
 expect(inviteCode(' abc+/xyz== ')).toBe('abc+/xyz==')
})
