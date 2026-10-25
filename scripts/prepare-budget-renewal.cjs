#!/usr/bin/env node
'use strict';
// Offline review artifact only: no SDK, network, counters, credentials or deployment.
const {budgetMonthStatus}=require('../backend/index.js');
function planRenewal({parameters,approval,now=Date.now}){
 if(!parameters||!approval||approval.ownerApproved!==true||approval.providerAllocationVerified!==true||approval.otherConsumersReconciled!==true)throw Error('Explicit owner/provider allocation review required');
 const time=now(),status=budgetMonthStatus({budgetMonth:parameters.BudgetMonth,nextBudgetMonth:parameters.NextBudgetMonth??'',now:()=>time});
 if(!status.allowed)throw Error('Current month is not approved; reconcile the expired allocation separately');
 const next=new Date(Date.UTC(Number(status.currentMonth.slice(0,4)),Number(status.currentMonth.slice(5)),1)).toISOString().slice(0,7);
 if(approval.month!==next)throw Error('Approval must name the immediate next UTC month');
 if(parameters.PaidUsageEnabled!=='false'||parameters.PaidSearchMonthlyCredits!=='0')throw Error('Paid usage must remain disabled');
 const limits={FreeSearchMonthlyCredits:500,SearchDailyLimit:60,DetailMonthlyLimit:200,DetailDailyLimit:100,TotalDailyLimit:150,UpstreamPerSecondLimit:5};
 for(const [key,ceiling] of Object.entries(limits))if(typeof parameters[key]!=='string'||!/^(?:0|[1-9][0-9]*)$/.test(parameters[key])||Number(parameters[key])>ceiling)throw Error('Approved consumption ceilings must be preserved');
 if(!Number.isSafeInteger(approval.availableFreeSearchCredits)||approval.availableFreeSearchCredits<Number(parameters.FreeSearchMonthlyCredits)||!Number.isSafeInteger(approval.availableDetailRequests)||approval.availableDetailRequests<Number(parameters.DetailMonthlyLimit))throw Error('Verified allocation does not cover unchanged service caps');
 const changes={BudgetMonth:status.currentMonth,NextBudgetMonth:next};
 const keys=[...new Set([...Object.keys(parameters),'NextBudgetMonth'])];
 return {reviewOnly:true,currentMonth:status.currentMonth,approvedMonth:next,parameters:keys.map(key=>Object.hasOwn(changes,key)&&parameters[key]!==changes[key]?{ParameterKey:key,ParameterValue:changes[key]}:{ParameterKey:key,UsePreviousValue:true})};
}
module.exports={planRenewal};
if(require.main===module){
 try{const fs=require('node:fs');const [parametersFile,approvalFile]=process.argv.slice(2);if(!parametersFile||!approvalFile)throw Error('Usage: node scripts/prepare-budget-renewal.cjs parameters.json approval.json');const plan=planRenewal({parameters:JSON.parse(fs.readFileSync(parametersFile,'utf8')),approval:JSON.parse(fs.readFileSync(approvalFile,'utf8'))});process.stdout.write(JSON.stringify(plan,null,2)+'\n');}
 catch(error){console.error(error.message);process.exitCode=1;}
}
