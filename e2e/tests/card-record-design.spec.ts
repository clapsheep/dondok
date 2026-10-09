import { expect, test, type Page } from '@playwright/test'

test.use({ serviceWorkers:'block' })
const purchase = {transactionId:'design-purchase',type:'EXPENSE',transferSubtype:null,transferPurpose:null,managementType:'CARD_PURCHASE',relatedPurchaseTransactionId:null,cardPayment:null,occurredOn:'2026-10-09',amountWon:126000,statisticsAmountWon:42000,category:{categoryId:'food',name:'식비'},performedBy:{memberId:'me',displayName:'지우'},createdBy:{memberId:'other',displayName:'민서'},asset:{assetId:'card',name:'생활비 카드'},description:'우리의 저녁',excludedFromStatistics:false,postings:[{assetId:'card',assetName:'생활비 카드',deltaWon:-126000}],installmentCount:1,version:4,createdAt:'2026-10-09T00:00:00Z',updatedAt:'2026-10-09T00:00:00Z'}
const management = {purchase,billingSnapshot:{cardAssetId:'card',cardAssetName:'생활비 카드',statementClosingDay:30,paymentDay:15,paymentMonthOffset:1,installmentCount:1},refundableAmountWon:126000,charges:[],statements:[],refunds:[]}
const ledger={ledgerId:'review',version:1,members:[{memberId:'me',displayName:'지우',currentUser:true,joinedAt:'2026-01-01'},{memberId:'other',displayName:'민서',currentUser:false,joinedAt:'2026-01-01'}]}
async function mock(page:Page) {
  const requests:Array<{path:string;body:any;key:string|undefined}>=[]
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(route.request().method()==='POST') {
      const body=route.request().postDataJSON(); requests.push({path,body,key:route.request().headers()['idempotency-key']})
      if(path.endsWith('/preview')) return route.fulfill({json:{previewToken:'review-token',purchaseVersion:4,refundableAmountWon:126000,unpaidCardReductionWon:10000,accountReturns:[]}})
      if(path.endsWith('/card-purchase-corrections')) return route.fulfill({json:{...management,purchase:{...purchase,...body,version:5}}})
      if(path.endsWith('/card-purchase-refunds')) return route.fulfill({json:{purchase,refundTransaction:{...purchase,transactionId:'refund',managementType:'CARD_REFUND'},unpaidCardReductionWon:10000,accountReturns:[]}})
      return route.fulfill({status:405,json:{detail:'Unexpected test mutation'}})
    }
    const data:Record<string,unknown>={
      '/api/auth/me':{userId:'user',loginId:'preview',displayName:'지우',email:'preview@example.test'},
      '/api/auth/csrf':{headerName:'X-CSRF-TOKEN',token:'test-only-token'},
      '/api/ledger-books/current':{ledger},
      '/api/assets':[{assetId:'card',name:'생활비 카드',assetTypeName:'신용카드',systemCode:'CREDIT_CARD',behavior:'CREDIT_CARD',ownershipScope:'PERSONAL',ownerMemberId:'me',status:'ACTIVE',currentBalanceWon:-126000,nearestCardPaymentDueWon:126000}],
      '/api/categories':[{categoryId:'food',name:'식비',kind:'EXPENSE',version:1,isFallback:false}],
      '/api/transactions/design-purchase/card-purchase-management':management,
    }
    await route.fulfill({status:path in data?200:404,json:data[path]??{detail:'No mock route'},headers:{'X-Request-Id':'card-editor-design'}})
  })
  return requests
}

for(const action of ['correction','refund'] as const) {
  test(`카드 ${action} 입력은 기록 UI와 모바일 단계를 공유하고 확인 후에만 저장한다`,async({page},testInfo)=>{
    const evidence:unknown[]=[]
    page.on('pageerror',error=>evidence.push({error:error.message}))
    page.on('console',message=>{if(message.type()==='error')evidence.push({console:message.text()})})
    page.on('response',response=>{if(new URL(response.url()).pathname.startsWith('/api/'))evidence.push({path:new URL(response.url()).pathname,status:response.status(),requestId:response.headers()['x-request-id']})})
    const requests=await mock(page)
    await testInfo.attach('seed-manifest',{body:JSON.stringify({ledger,management,action,mocked:true}),contentType:'application/json'})
    try {
      await page.setViewportSize({width:390,height:844})
      await page.goto(`/transactions/design-purchase/card-purchase/${action}`)
      const date=page.getByRole('button',{name:action==='correction'?'구매 날짜':'환불일',exact:true})
      await expect(date).toBeVisible()
      await expect(page.getByRole('img',{name:new RegExp(`진행: ${action==='correction'?3:2}단계 중 1단계`)})).toBeVisible()
      await page.getByRole('button',{name:'다음',exact:true}).click()
      if(action==='correction') {
        await expect(page.getByRole('button',{name:/분류 선택, 현재 식비/})).toBeVisible()
        await page.getByRole('button',{name:'다음',exact:true}).click()
      }
      const amount=page.getByLabel(action==='correction'?'금액':'환불 금액',{exact:true})
      const statistics=page.getByLabel(action==='correction'?'지출로 반영할 금액':'지출에서 차감할 금액',{exact:true})
      await amount.fill(action==='correction'?'90,000':'10,000')
      await statistics.fill(action==='correction'?'30,000':'3,000')
      const description=page.getByRole('textbox',{name:'내용 (선택)',exact:true})
      await expect(description).toHaveAttribute('maxlength','40')
      await description.fill('확인 후에 저장할 내용')
      await page.getByRole('switch',{name:'지출에 포함하지 않기',exact:true}).check()
      await description.focus()
      for(const width of [320,834,1280,390]) {
        await page.setViewportSize({width,height:900})
        await expect(description).toBeVisible()
        await expect(description).toHaveValue('확인 후에 저장할 내용')
        await expect(description).toBeFocused()
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
      }
      const actionButton=page.getByRole('button',{name:action==='correction'?'정정 저장':'환불 내용 확인',exact:true})
      await actionButton.click()
      const confirmation=action==='correction'?page.getByRole('dialog',{name:'정정 내용을 저장할까요?'}):page.getByRole('region',{name:'환불 반영 내용'})
      await expect(confirmation).toBeVisible()
      expect(requests).toHaveLength(1)
      expect(requests[0].body).toMatchObject({amountWon:action==='correction'?90000:10000,statisticsAmountWon:action==='correction'?30000:3000,expectedVersion:4,excludedFromStatistics:true,description:'확인 후에 저장할 내용'})
      await confirmation.getByRole('button',{name:action==='correction'?'저장':'환불 기록',exact:true}).click()
      await expect(page).toHaveURL(/\/card-purchase$/)
      await expect(page.getByRole('status').filter({ hasText: action==='correction'?'정정했어요':'환불을 기록했어요' })).toBeVisible()
      expect(requests).toHaveLength(2)
      expect(requests[1].body.previewToken).toBe('review-token')
      expect(requests[1].key).toBeTruthy()
      expect(evidence.filter((item:any)=>item.error)).toEqual([])
    } finally {
      await testInfo.attach('console-network-request-ids',{body:JSON.stringify(evidence),contentType:'application/json'})
    }
  })
}
