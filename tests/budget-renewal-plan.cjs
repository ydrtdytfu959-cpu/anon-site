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
