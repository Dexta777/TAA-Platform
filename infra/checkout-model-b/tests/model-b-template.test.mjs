import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import { parseDocument } from 'yaml';

const templateSource = await readFile(new URL('../template.yaml', import.meta.url), 'utf8');

function cloudFormationScalarTag(tag, key) {
  return {
    tag: `!${tag}`,
    resolve: (value) => ({ [key]: value }),
  };
}

const templateDocument = parseDocument(templateSource, {
  customTags: [
    cloudFormationScalarTag('Ref', 'Ref'),
    cloudFormationScalarTag('Sub', 'Fn::Sub'),
    cloudFormationScalarTag('GetAtt', 'Fn::GetAtt'),
  ],
});

assert.deepEqual(templateDocument.errors, []);
assert.deepEqual(templateDocument.warnings, []);

const template = templateDocument.toJS();
const resources = template.Resources;
const EXECUTION_TAG_KEY = 'TAA-Control';
const EXECUTION_TAG_VALUE = 'CheckoutModelB';
const EXECUTION_ARN =
  'arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:automation-execution/*';
const DOCUMENT_ARN =
  'arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:document/${EmergencyDisableDocument}';
const DEFINITION_ARN =
  'arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:automation-definition/${EmergencyDisableDocument}:1';

function statementsFor(resourceName) {
  return resources[resourceName].Properties.PolicyDocument.Statement;
}

function statementBySid(statements, sid) {
  const matches = statements.filter((statement) => statement.Sid === sid);
  assert.equal(matches.length, 1, `${sid} must appear exactly once`);
  return matches[0];
}

function actionsFor(statement) {
  return Array.isArray(statement.Action) ? statement.Action : [statement.Action];
}

function subValue(resource) {
  return resource?.['Fn::Sub'];
}

function validateMegPolicy(statements) {
  const start = statementBySid(statements, 'AllowPinnedAutomationExecutionWithMfa');
  assert.equal(start.Effect, 'Allow');
  assert.deepEqual(actionsFor(start), ['ssm:StartAutomationExecution']);
  assert.deepEqual(start.Resource.map(subValue), [DOCUMENT_ARN, DEFINITION_ARN, EXECUTION_ARN]);
  assert.deepEqual(start.Condition, {
    Bool: {
      'aws:MultiFactorAuthPresent': 'true',
    },
    StringEquals: {
      [`aws:RequestTag/${EXECUTION_TAG_KEY}`]: EXECUTION_TAG_VALUE,
    },
    'ForAnyValue:StringEquals': {
      'ssm:DocumentVersion': ['1'],
    },
    'ForAllValues:StringEquals': {
      'aws:TagKeys': [EXECUTION_TAG_KEY],
    },
  });

  const receiptRead = statementBySid(statements, 'AllowAutomationReceiptReadWithMfa');
  assert.equal(receiptRead.Effect, 'Allow');
  assert.deepEqual(
    actionsFor(receiptRead).sort(),
    ['ssm:DescribeAutomationStepExecutions', 'ssm:GetAutomationExecution'].sort()
  );
  assert.equal(subValue(receiptRead.Resource), EXECUTION_ARN);
  assert.deepEqual(receiptRead.Condition, {
    Bool: {
      'aws:MultiFactorAuthPresent': 'true',
    },
    StringEquals: {
      [`aws:ResourceTag/${EXECUTION_TAG_KEY}`]: EXECUTION_TAG_VALUE,
    },
  });

  const documentRead = statementBySid(statements, 'AllowPinnedDocumentReadWithMfa');
  assert.deepEqual(
    actionsFor(documentRead).sort(),
    ['ssm:DescribeDocument', 'ssm:GetDocument'].sort()
  );
  assert.equal(subValue(documentRead.Resource), DOCUMENT_ARN);
  assert.deepEqual(documentRead.Condition, {
    Bool: {
      'aws:MultiFactorAuthPresent': 'true',
    },
  });

  const passRole = statementBySid(statements, 'AllowPassOnlyModelBAutomationRoleWithMfa');
  assert.deepEqual(actionsFor(passRole), ['iam:PassRole']);
  assert.deepEqual(passRole.Resource, { 'Fn::GetAtt': 'ModelBAutomationExecutionRole.Arn' });
  assert.deepEqual(passRole.Condition, {
    Bool: {
      'aws:MultiFactorAuthPresent': 'true',
    },
    StringEquals: {
      'iam:PassedToService': 'ssm.amazonaws.com',
    },
  });

  const allowedActions = statements
    .filter((statement) => statement.Effect === 'Allow')
    .flatMap(actionsFor)
    .sort();
  assert.deepEqual(
    allowedActions,
    [
      'iam:PassRole',
      'ssm:DescribeAutomationStepExecutions',
      'ssm:DescribeDocument',
      'ssm:GetAutomationExecution',
      'ssm:GetDocument',
      'ssm:StartAutomationExecution',
    ].sort()
  );
  assert.doesNotMatch(
    JSON.stringify(allowedActions),
    /DescribeAutomationExecutions|AddTagsToResource/
  );
}

test('SSM Automation has zero operator parameters and invokes one immutable Lambda version', () => {
  const content = resources.EmergencyDisableDocument.Properties.Content;

  assert.equal(Object.hasOwn(content, 'parameters'), false);
  assert.equal(content.mainSteps.length, 1);
  assert.deepEqual(content.mainSteps[0], {
    name: 'DisableCheckoutReservations',
    action: 'aws:invokeLambdaFunction',
    maxAttempts: 1,
    timeoutSeconds: 20,
    onFailure: 'Abort',
    inputs: {
      FunctionName: { Ref: 'ModelBFunctionVersion' },
      InvocationType: 'RequestResponse',
      LogType: 'None',
    },
  });
  assert.deepEqual(content.outputs, ['DisableCheckoutReservations.Payload']);
});

test('Lambda version captures code and fixed deployment configuration immutably', () => {
  const lambda = resources.ModelBFunction.Properties;
  const version = resources.ModelBFunctionVersion;

  assert.deepEqual(lambda.Environment.Variables.TAA_MODEL_B_SUPABASE_PROJECT_REF, {
    Ref: 'SupabaseProductionProjectRef',
  });
  assert.deepEqual(lambda.Environment.Variables.TAA_MODEL_B_CREDENTIAL_SECRET_ARN, {
    Ref: 'ModelBCredentialSecretArn',
  });
  assert.equal(version.Type, 'AWS::Lambda::Version');
  assert.deepEqual(version.Properties.CodeSha256, { Ref: 'LambdaCodeSha256' });
  assert.deepEqual(template.Parameters.SupabaseProductionProjectRef.AllowedValues, [
    'zxmywtmjvfjgdjcstgtn',
  ]);
});

test('Meg identity policy and permissions boundary enforce the same tagged execution surface', () => {
  const boundary = statementsFor('MegModelBPermissionsBoundary');
  const executionPolicy = statementsFor('MegModelBExecutionPolicy');

  validateMegPolicy(boundary);
  validateMegPolicy(executionPolicy);
  assert.deepEqual(boundary, executionPolicy);
});

test('structured policy validation rejects every widened execution-read or tag variant', () => {
  const source = statementsFor('MegModelBExecutionPolicy');
  const unsafeVariants = [];

  const unconditionedRead = globalThis.structuredClone(source);
  delete statementBySid(unconditionedRead, 'AllowAutomationReceiptReadWithMfa').Condition;
  unsafeVariants.push(unconditionedRead);

  const missingResourceTag = globalThis.structuredClone(source);
  delete statementBySid(missingResourceTag, 'AllowAutomationReceiptReadWithMfa').Condition
    .StringEquals;
  unsafeVariants.push(missingResourceTag);

  const listAllExecutions = globalThis.structuredClone(source);
  statementBySid(listAllExecutions, 'AllowAutomationReceiptReadWithMfa').Action.push(
    'ssm:DescribeAutomationExecutions'
  );
  unsafeVariants.push(listAllExecutions);

  const addTags = globalThis.structuredClone(source);
  statementBySid(addTags, 'AllowAutomationReceiptReadWithMfa').Action.push('ssm:AddTagsToResource');
  unsafeVariants.push(addTags);

  const arbitraryTagKey = globalThis.structuredClone(source);
  statementBySid(arbitraryTagKey, 'AllowPinnedAutomationExecutionWithMfa').Condition[
    'ForAllValues:StringEquals'
  ]['aws:TagKeys'].push('AnotherTag');
  unsafeVariants.push(arbitraryTagKey);

  const alternateTagValue = globalThis.structuredClone(source);
  statementBySid(alternateTagValue, 'AllowPinnedAutomationExecutionWithMfa').Condition.StringEquals[
    `aws:RequestTag/${EXECUTION_TAG_KEY}`
  ] = 'AnotherControl';
  unsafeVariants.push(alternateTagValue);

  const alternateDocument = globalThis.structuredClone(source);
  statementBySid(alternateDocument, 'AllowPinnedAutomationExecutionWithMfa').Resource[0] = {
    'Fn::Sub': 'arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:document/*',
  };
  unsafeVariants.push(alternateDocument);

  const alternateVersion = globalThis.structuredClone(source);
  statementBySid(alternateVersion, 'AllowPinnedAutomationExecutionWithMfa').Condition[
    'ForAnyValue:StringEquals'
  ]['ssm:DocumentVersion'] = ['2'];
  unsafeVariants.push(alternateVersion);

  for (const variant of unsafeVariants) {
    assert.throws(() => validateMegPolicy(variant));
  }
});

test('the Automation role can invoke only the immutable function version', () => {
  const role = resources.ModelBAutomationExecutionRole.Properties;
  const allow = role.Policies[0].PolicyDocument.Statement[0];
  const trust = role.AssumeRolePolicyDocument.Statement[0];

  assert.deepEqual(actionsFor(allow), ['lambda:InvokeFunction']);
  assert.deepEqual(allow.Resource, { Ref: 'ModelBFunctionVersion' });
  assert.deepEqual(trust.Principal, { Service: 'ssm.amazonaws.com' });
  assert.deepEqual(trust.Condition.StringEquals, {
    'aws:SourceAccount': { Ref: 'AWS::AccountId' },
  });
  assert.match(trust.Condition.ArnLike['aws:SourceArn']['Fn::Sub'], /automation-execution\/\*$/);
});

test('the Lambda role reads only the dedicated AWS secret and writes only its log group', () => {
  const logGroup = resources.ModelBLogGroup;
  const role = resources.ModelBLambdaExecutionRole.Properties;
  const [secretPolicy, logPolicy] = role.Policies;
  const secretAllow = secretPolicy.PolicyDocument.Statement[0];
  const logAllow = logPolicy.PolicyDocument.Statement[0];

  assert.equal(logGroup.DeletionPolicy, 'Retain');
  assert.equal(logGroup.UpdateReplacePolicy, 'Retain');
  assert.equal(logGroup.Properties.RetentionInDays, 365);
  assert.deepEqual(actionsFor(secretAllow), ['secretsmanager:GetSecretValue']);
  assert.deepEqual(secretAllow.Resource, { Ref: 'ModelBCredentialSecretArn' });
  assert.deepEqual(
    actionsFor(logAllow).sort(),
    ['logs:CreateLogStream', 'logs:PutLogEvents'].sort()
  );
  assert.match(logAllow.Resource['Fn::Sub'], /taa-emergency-disable-checkout-reservations:\*$/);
});

test('template creates neither a credential value nor a programmatic Meg credential', () => {
  const resourceTypes = Object.values(resources).map((resource) => resource.Type);
  const meg = resources.MegModelBUser.Properties;

  assert.equal(resourceTypes.includes('AWS::SecretsManager::Secret'), false);
  assert.equal(resourceTypes.includes('AWS::IAM::AccessKey'), false);
  assert.equal(Object.hasOwn(meg, 'LoginProfile'), false);
  assert.equal(meg.UserName, 'taa-meg-checkout-rollback');
  assert.deepEqual(meg.PermissionsBoundary, { Ref: 'MegModelBPermissionsBoundary' });
});
