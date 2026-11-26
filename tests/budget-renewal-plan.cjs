'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planRenewal}=require('../scripts/prepare-budget-renewal.cjs');
const parameters={BudgetMonth:'2026-10',NextBudgetMonth:'',FreeSearchMonthlyCredits:'500',SearchDailyLimit:'60',DetailMonthlyLimit:'200',DetailDailyLimit:'100',TotalDailyLimit:'150',UpstreamPerSecondLimit:'5',PaidUsageEnabled:'false',PaidSearchMonthlyCredits:'0',Channel3SecretArn:'fixture-reference'};
const approval={month:'2026-11',ownerApproved:true,providerAllocationVerified:true,otherConsumersReconciled:true,availableFreeSearchCredits:500,availableDetailRequests:200};
const now=()=>Date.parse('2026-10-23T12:00:00Z');
test('renewal changes only the approved successor and never embeds unrelated parameter values',()=>{
 const plan=planRenewal({parameters,approval,now});
 assert.deepEqual(plan.parameters.filter(p=>!p.UsePreviousValue),[{ParameterKey:'NextBudgetMonth',ParameterValue:'2026-11'}]);
 assert.equal(plan.parameters.length,Object.keys(parameters).length);assert.ok(!JSON.stringify(plan).includes('fixture-reference'));
});
test('renewal requires all explicit allocation attestations and sufficient free headroom',()=>{
 for(const patch of [{ownerApproved:false},{providerAllocationVerified:false},{otherConsumersReconciled:false},{availableFreeSearchCredits:499},{availableDetailRequests:199},{month:'2026-12'}])assert.throws(()=>planRenewal({parameters,approval:{...approval,...patch},now}));
 for(const patch of [{PaidUsageEnabled:'true'},{PaidSearchMonthlyCredits:'1'},{FreeSearchMonthlyCredits:'501'},{SearchDailyLimit:'61'},{DetailMonthlyLimit:'201'},{TotalDailyLimit:'151'}])assert.throws(()=>planRenewal({parameters:{...parameters,...patch},approval,now}));
});
test('following renewal promotes the previously approved month without resetting counters',()=>{
 const plan=planRenewal({parameters:{...parameters,NextBudgetMonth:'2026-11'},approval:{...approval,month:'2026-12'},now:()=>Date.parse('2026-11-20T00:00:00Z')});
 assert.deepEqual(plan.parameters.filter(p=>!p.UsePreviousValue),[{ParameterKey:'BudgetMonth',ParameterValue:'2026-11'},{ParameterKey:'NextBudgetMonth',ParameterValue:'2026-12'}]);
 assert.throws(()=>planRenewal({parameters,approval:{...approval,month:'2026-12'},now:()=>Date.parse('2026-11-20T00:00:00Z')}));
});

test('explicit expired-month recovery authorizes only the current month and preserves every other parameter',()=>{
 const expired={...parameters,BudgetMonth:'2026-09',NextBudgetMonth:'2026-10'};
 const time=()=>Date.parse('2026-11-26T12:00:00Z');
 const recovery={...approval,month:'2026-11',recoverExpiredMonth:true,currentMonthCountersReconciled:true};
 const plan=planRenewal({parameters:expired,approval:recovery,now:time});
 assert.equal(plan.reviewOnly,true);
 assert.equal(plan.approvedMonth,'2026-11');
 assert.deepEqual(plan.parameters.filter(p=>!p.UsePreviousValue),[{ParameterKey:'BudgetMonth',ParameterValue:'2026-11'},{ParameterKey:'NextBudgetMonth',ParameterValue:''}]);
 assert.equal(plan.parameters.length,Object.keys(expired).length);
 assert.ok(!JSON.stringify(plan).includes('fixture-reference'));
 for(const patch of [{recoverExpiredMonth:false},{currentMonthCountersReconciled:false},{providerAllocationVerified:false},{otherConsumersReconciled:false},{ownerApproved:false},{month:'2026-12'},{availableFreeSearchCredits:499},{availableDetailRequests:199}])
  assert.throws(()=>planRenewal({parameters:expired,approval:{...recovery,...patch},now:time}));
});
test('expired-month recovery cannot initialize an unconfigured or future budget or overwrite a valid month',()=>{
 const time=()=>Date.parse('2026-11-26T12:00:00Z');
 const recovery={...approval,month:'2026-11',recoverExpiredMonth:true,currentMonthCountersReconciled:true};
 for(const BudgetMonth of ['','2026-12','2026-11'])
  assert.throws(()=>planRenewal({parameters:{...parameters,BudgetMonth,NextBudgetMonth:''},approval:recovery,now:time}));
});
