'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildTemplate}=require('../backend/build-template.cjs');
test('next-month allocation remains opt-in and diagnostics receive only a private scheduled event',()=>{
  const {Parameters:p,Resources:r}=buildTemplate('fixture-source');
  assert.equal(p.NextBudgetMonth?.Default,'');
  assert.deepEqual(r.Channel3Function.Properties.Environment.Variables.NEXT_BUDGET_MONTH,{Ref:'NextBudgetMonth'});
  assert.equal(r.BudgetMonitorSchedule?.Type,'AWS::Events::Rule');
  assert.equal(r.BudgetMonitorSchedule.Properties.ScheduleExpression,'rate(1 hour)');
  assert.equal(r.BudgetMonitorSchedule.Properties.Targets.length,1);
  assert.deepEqual(JSON.parse(r.BudgetMonitorSchedule.Properties.Targets[0].Input),{operation:'budget-status'});
  const permission=r.BudgetMonitorPermission.Properties;assert.equal(permission.Principal,'events.amazonaws.com');
  assert.deepEqual(permission.SourceArn,{'Fn::GetAtt':['BudgetMonitorSchedule','Arn']});assert.deepEqual(permission.SourceAccount,{Ref:'AWS::AccountId'});
  assert.ok(Object.values(r).filter(v=>v.Type==='AWS::ApiGatewayV2::Route').every(v=>!v.Properties.RouteKey.includes('budget')));
});
test('month availability and approaching expiry have dedicated connected alarms and missing monitor is observable',()=>{
  const r=buildTemplate('fixture-source').Resources;
  for(const [name,metric] of [['BudgetMonthUnavailableAlarm','budget_month_unavailable'],['BudgetMonthExpiringAlarm','budget_month_expiring'],['BudgetMonitorMissingAlarm','budget_monitor_check']]){
    assert.equal(r[name]?.Type,'AWS::CloudWatch::Alarm');assert.equal(r[name].Properties.MetricName,metric);assert.ok(r[name].Properties.AlarmActions['Fn::If']);
  }
  assert.equal(r.BudgetMonitorMissingAlarm.Properties.TreatMissingData,'breaching');
  assert.equal(r.BudgetMonitorMissingAlarm.Properties.ComparisonOperator,'LessThanThreshold');
});
