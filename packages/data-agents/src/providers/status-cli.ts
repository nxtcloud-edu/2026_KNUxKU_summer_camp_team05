import { providerStatuses } from './status.js';

console.log('Provider 상태 확인 (Network I/O 없음)');
for (const status of providerStatuses()) {
  console.log(
    [
      status.providerId,
      `credential=${status.credentialState}`,
      `adapter=${status.adapterState}`,
      `authentication=${status.authenticationState}`,
      `candidate=${status.candidateNormalization}`,
      `automaticSupply=${status.automaticCandidateSupply}`,
    ].join(' | '),
  );
}
console.log('Key 존재·Adapter 생성은 실제 인증, Candidate 자동 공급, VERIFIED, BOOKABLE을 증명하지 않습니다.');
