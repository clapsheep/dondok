import { expect, test, type Page, type TestInfo } from '@playwright/test'

test.use({serviceWorkers:'block'})
const ledger={ledgerId:'review',version:1,members:[{memberId:'me',displayName:'지우',currentUser:true,joinedAt:'2026-01-01'}]}
const base={paymentSourceCapable:true,ownershipScope:'PERSONAL',ownerMemberId:'me',openedOn:'2026-01-01',memo:null,openingBalanceWon:0,currentMonthCardPaymentDueWon:0,nextMonthCardPaymentDueWon:0,nearestCardPaymentDueOn:null,nearestCardPaymentDueWon:0,followingCardPaymentDueOn:null,followingCardPaymentDueWon:0,status:'ACTIVE',archivedAt:null,version:1,cardSettings:null,debitCardSettings:null,savingsSettings:null}
const bank={...base,assetId:'bank',assetTypeId:'type-bank',assetTypeName:'입출금',systemCode:'BANK',behavior:'STANDARD',name:'생활비 통장',currentBalanceWon:500000}
const card={...base,assetId:'card',assetTypeId:'type-card',assetTypeName:'신용카드',systemCode:'CREDIT_CARD',behavior:'CREDIT_CARD',name:'생활비 카드',currentBalanceWon:-120000,paymentSourceCapable:false,cardSettings:{statementClosingDay:30,paymentDay:15,paymentMonthOffset:1,settlementAssetId:'bank',autoSettlementEnabled:false}}
const statement={statementId:'statement',cardAsset:{assetId:'card',name:'생활비 카드'},dueOn:'2026-11-15',status:'OPEN',grossAmountWon:120000,paidAmountWon:0,remainingAmountWon:120000,prepayableAmountWon:120000,additionalUsageAfterPayment:false,version:1,automaticSettlement:null,settlementAsset:{assetId:'bank',name:'생활비 통장',currentBalanceWon:500000},autoSettlementEnabled:false,payments:[]}
const categories=[{categoryId:'food',name:'식비',kind:'EXPENSE',isFallback:false,transactionCount:2,version:1,sortOrder:0},{categoryId:'other',name:'기타',kind:'EXPENSE',isFallback:true,transactionCount:0,version:1,sortOrder:1}]
async function setup(page:Page,testInfo:TestInfo,{publicPage=false,noLedger=false}={}) {
 const requests:Array<{path:string;body:any;key?:string}>=[],errors:string[]=[],network:unknown[]=[]
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')network.push({console:m.text()})})
 page.on('response',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))network.push({path:new URL(r.url()).pathname,status:r.status(),requestId:r.headers()['x-request-id']})})
 const fixture:Record<string,unknown>={
 '/api/auth/me':{userId:'user',displayName:'지우',loginId:'review',email:'review@example.test'},'/api/auth/csrf':{headerName:'X-CSRF-TOKEN',token:'mock'},'/api/ledger-books/current':{ledger:noLedger?null:ledger},
 '/api/legal':{version:'test',terms:'테스트용 공동 가계부 이용약관',privacy:'테스트용 개인정보 안내',collection:'테스트용 동의\n\n필수 수집 정보 안내'},
 '/api/assets':[bank,card],'/api/assets/bank':bank,'/api/assets/card':card,
 '/api/asset-types':[bank,card].map(a=>({assetTypeId:a.assetTypeId,name:a.assetTypeName,systemCode:a.systemCode,behavior:a.behavior,paymentSourceCapable:a.paymentSourceCapable})),
 '/api/categories':categories,
 '/api/assets/card/card-payment-items':{items:[{chargeId:'charge',statementId:'statement',sourceTransactionId:'purchase',description:'생활비',occurredOn:'2026-09-28',cycleEnd:'2026-09-30',dueOn:'2026-11-15',installmentNo:1,installmentCount:1,remainingAmountWon:120000,origin:'PURCHASE'}],nextCursor:null,recentClosingOn:'2026-09-30',snapshotToken:'snapshot',totals:{amountWon:120000,count:1,closedAmountWon:120000,closedCount:1}},
 '/api/assets/card/card-statements':{items:[statement],nextCursor:null},'/api/card-statements/statement':statement,
 }
 await page.route('**/api/**',async route=>{
 const path=new URL(route.request().url()).pathname
 if(publicPage && ['/api/auth/me','/api/ledger-books/current'].includes(path)) return route.fulfill({status:401,json:{detail:'Test unsigned session'}})
 if(route.request().method()!=='GET') {requests.push({path,body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']}); if(path==='/api/auth/sign-up')return route.fulfill({status:201,json:{email:'review@example.test'}});if(path==='/api/assets/card/card-payments')return route.fulfill({status:201,json:{batchId:'batch',amountWon:25000}});return route.fulfill({status:405,json:{detail:'Blocked test mutation'}})}
 if(path.endsWith('/availability')) return route.fulfill({json:{available:true}})
 await route.fulfill({status:path in fixture?200:404,json:fixture[path]??{detail:'No mock'},headers:{'X-Request-Id':'remaining-design'}})
 })
 await testInfo.attach('seed-manifest',{body:JSON.stringify({fixture,mocked:true}),contentType:'application/json'})
 return {requests,errors,finish:async()=>{await testInfo.attach('console-network-request-ids',{body:JSON.stringify({network,errors}),contentType:'application/json'});expect(errors).toEqual([])}}
}

test('회원가입 단계는 입력과 동의를 보존하고 마지막에 한 번만 제출한다',async({page},testInfo)=>{
 const proof=await setup(page,testInfo,{publicPage:true})
 try {
 await page.setViewportSize({width:390,height:844});await page.goto('/sign-up')
 await expect(page.getByRole('img',{name:'가입 진행: 3단계 중 1단계'})).toBeVisible()
 await page.getByLabel('이름',{exact:true}).fill('지우');await page.getByLabel('이메일',{exact:true}).fill('review@example.test')
 await page.getByRole('button',{name:'다음',exact:true}).click()
 await page.getByLabel('아이디',{exact:true}).fill('review_2026');await page.getByRole('button',{name:'중복 확인',exact:true}).click();await expect(page.getByRole('button',{name:'확인 완료',exact:true})).toBeVisible()
 await page.getByLabel('비밀번호',{exact:true}).fill('Review-only-2026!');await page.getByLabel('비밀번호 확인',{exact:true}).fill('Review-only-2026!')
 await page.getByRole('button',{name:'다음',exact:true}).click();expect(proof.requests).toHaveLength(0)
 await page.getByRole('button',{name:'가입하고 인증 메일 받기',exact:true}).click();await expect(page.getByRole('alert')).toContainText('필수 동의를 완료')
 await page.getByRole('button',{name:'이용약관 내용 보기'}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape')
 for(const name of ['[필수] 만 14세 이상입니다','[필수] 이용약관 동의','[필수] 개인정보 수집·이용 동의']) {const box=page.getByRole('checkbox',{name,exact:true});await expect(box).not.toBeChecked();await box.check()}
 for(const width of [320,834,1280,390]) {await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('checkbox',{name:'[필수] 이용약관 동의',exact:true})).toBeChecked()}
 await page.getByRole('button',{name:'이전 가입 단계'}).click();await expect(page.getByLabel('아이디',{exact:true})).toHaveValue('review_2026');await page.getByRole('button',{name:'다음',exact:true}).click()
 await page.getByRole('button',{name:'가입하고 인증 메일 받기',exact:true}).click();await expect(page.getByRole('heading',{name:'이메일을 확인해 주세요'})).toBeVisible()
 expect(proof.requests).toHaveLength(1);expect(proof.requests[0].body).toMatchObject({loginId:'review_2026',displayName:'지우',email:'review@example.test',consent:{version:'test',age14OrOlder:true,termsAccepted:true,privacyAccepted:true}})
 } finally {await proof.finish()}
})

test('카드 결제 모바일 단계·회전·금액 선택은 기존 결제 요청을 보존한다',async({page},testInfo)=>{
 const proof=await setup(page,testInfo)
 try {
 await page.setViewportSize({width:390,height:844});await page.goto('/assets/card/card-payment')
 await expect(page.getByRole('img',{name:'결제 진행: 2단계 중 1단계'})).toBeVisible()
 await expect(page.getByRole('link',{name:'생활비 결제 내역 보기',exact:true})).toHaveCount(0)
 await page.getByRole('checkbox',{name:/생활비 1\/1회차 선택/}).uncheck();await expect(page.getByRole('button',{name:'다음',exact:true})).toBeDisabled();await page.getByRole('checkbox',{name:/생활비 1\/1회차 선택/}).check()
 await page.getByRole('tab',{name:'부분 금액 결제'}).click();const amount=page.getByLabel('결제할 금액',{exact:true});await page.getByRole('button',{name:'미결제 전액',exact:true}).click();await expect(amount).toHaveValue('120,000');await amount.fill('25000');await amount.press('Escape')
 await page.getByRole('button',{name:'다음',exact:true}).click();await expect(page.getByRole('button',{name:'출금 계좌',exact:true})).toBeVisible()
 const date=page.getByRole('button',{name:'실제 결제일',exact:true});const paidOn=await date.getAttribute('data-value');await date.focus()
 for(const width of [320,834,1280,390]) {await page.setViewportSize({width,height:900});await expect(date).toBeFocused();await expect(date).toHaveAttribute('data-value',paidOn!);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}
 await page.getByRole('button',{name:'변경',exact:true}).click();await expect(amount).toHaveValue('25,000');await page.getByRole('button',{name:'다음',exact:true}).click();expect(proof.requests).toHaveLength(0)
 await page.getByRole('button',{name:'결제 기록',exact:true}).click();await expect(page.getByRole('status').filter({ hasText: '25,000원 결제를 기록했어요.' })).toBeVisible()
 expect(proof.requests).toHaveLength(1);expect(proof.requests[0].body).toMatchObject({mode:'AMOUNT',amountWon:25000,settlementAssetId:'bank',paidOn,snapshotToken:'snapshot'});expect(proof.requests[0].key).toBeTruthy()
 } finally {await proof.finish()}
})

test('자산 편집·분류·결제 내역의 새 표면은 작은 화면과 다크 모드에서도 표시된다',async({page},testInfo)=>{
 const proof=await setup(page,testInfo)
 try {
 for(const [path,title] of [['/assets/bank/edit','자산 정보 수정'],['/settings/categories','분류 설정'],['/assets/card/card-statements/statement','2026. 11. 15. 카드 결제 내역']]) {
 await page.goto(path);await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible()
 for(const width of [390,1280]) {await page.setViewportSize({width,height:900});for(const dark of [false,true]) {await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),dark);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await testInfo.attach(`${path.split('/').at(-1)}-${width}-${dark?'dark':'light'}`,{body:await page.screenshot(),contentType:'image/png'})}}
 }
 await page.goto('/assets/bank/edit');const name=page.getByLabel('자산 이름 (선택)',{exact:true});await name.fill('새로운 통장 이름');await name.focus();await page.setViewportSize({width:390,height:844});await expect(name).toHaveValue('새로운 통장 이름');await expect(name).toBeFocused();await expect(page.getByRole('button',{name:'잔액 기준일',exact:true})).toBeVisible()
 } finally {await proof.finish()}
})

test('비로그인 첫 접속은 랜딩에서 로그인·가입으로 이어진다',async({page},testInfo)=>{
 const proof=await setup(page,testInfo,{publicPage:true})
 try {await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.getByRole('heading',{name:'따로 쓴 오늘도, 함께 보는 내일도.'})).toBeVisible();await page.getByRole('link',{name:'돈독 시작하기'}).click();await expect(page.getByRole('heading',{name:'돈독 회원가입'})).toBeVisible();await page.getByRole('link',{name:'로그인 화면으로',exact:true}).click();await expect(page.getByRole('heading',{name:'돈독에 로그인'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}finally{await proof.finish()}
})

test('첫 시작·초대·인증 보조 화면도 공통 표면과 모바일 폭을 유지한다',async({page},testInfo)=>{
 const proof=await setup(page,testInfo,{noLedger:true})
 try {
 await page.setViewportSize({width:320,height:800})
 for(const [path,title] of [['/','초대 코드를 받으셨나요?'],['/join','받은 초대를 확인해요'],['/forgot-password','비밀번호 찾기'],['/reset-password','새 비밀번호 설정'],['/check-email','이메일을 확인해 주세요'],['/verify-email','이메일을 확인하고 있어요']]) {
 await page.goto(path);await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 }
 } finally {await proof.finish()}
})
