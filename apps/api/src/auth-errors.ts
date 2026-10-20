// Log only diagnostic primitives; never request bodies, credentials or SDK session objects.
export function authDiagnostic(event:string,error:any,secrets:string[]=[]){
  let message=String(error?.message ?? 'Unknown authentication error');
  for(const secret of secrets)if(secret)message=message.split(secret).join('[redacted]');
  message=message.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted-token]')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g,'[redacted-key]')
    .replace(/Bearer\s+\S+/gi,'Bearer [redacted]')
    .replace(/((?:access_token|refresh_token|provider_token|token|service_role|secret_key|api_key|apikey|password)["']?\s*[:=]\s*)[^\s,&]+/gi,'$1[redacted]')
    .replace(/[\u0000-\u001f]/g,' ').slice(0,1200);
  return JSON.stringify({event,code:typeof error?.code==='string'?error.code.replace(/[^a-z0-9_]/gi,'').slice(0,80):undefined,status:typeof error?.status==='number'?error.status:undefined,message});
}
export const duplicateSignupMessage='이미 가입된 이메일입니다. 로그인하거나 비밀번호 찾기를 이용해 주세요.';
export const signupSuccessMessage='가입 신청이 완료되었습니다. 이메일 인증 후 로그인해 주세요. 관리자의 승인 후 업무공간을 사용할 수 있습니다.';
export function signupFailure(error:any):{message:string;status:number;code:string}{
  const code=error?.code ?? '',text=String(error?.message ?? '');
  if(['user_already_exists','email_exists'].includes(code)||/already (?:registered|exists)|user already/i.test(text))return {message:duplicateSignupMessage,status:409,code:'SIGNUP_EMAIL_EXISTS'};
  if(code==='weak_password'||error?.name==='AuthWeakPasswordError'||/password.*(?:least|weak|contain)/i.test(text)){
    const reasons:string[]=Array.isArray(error?.reasons)?error.reasons:[];
    if(reasons.includes('pwned')||/pwned|breached|compromised/i.test(text))return {message:'유출 이력이 있는 비밀번호입니다. 다른 비밀번호를 사용해 주세요.',status:400,code:'SIGNUP_PASSWORD_POLICY'};
    const minimum=/(?:at least|minimum(?: length)?(?: of)?)\s+(\d{1,3})/i.exec(text)?.[1];
    const requirements:string[]=[];
    if(minimum)requirements.push(`${minimum}자 이상`);
    if(/ABCDEFGHIJKLMNOPQRSTUVWXYZ|uppercase/i.test(text))requirements.push('영문 대문자 포함');
    if(/abcdefghijklmnopqrstuvwxyz|lowercase/i.test(text))requirements.push('영문 소문자 포함');
    if(/0123456789|digit|number/i.test(text))requirements.push('숫자 포함');
    if(/special|symbol|!@#/i.test(text))requirements.push('특수문자 포함');
    return {message:requirements.length?`비밀번호 조건: ${requirements.join(', ')}. 조건에 맞게 다시 입력해 주세요.`:'비밀번호 정책을 충족하지 않습니다. 비밀번호 길이와 필요한 문자 조합을 확인해 주세요.',status:400,code:'SIGNUP_PASSWORD_POLICY'};
  }
  if(['email_address_invalid'].includes(code)||/invalid.*email|email.*invalid|unable to validate email/i.test(text))return {message:'이메일 주소 형식을 확인해 주세요. 오타 없이 사용 가능한 이메일을 입력해 주세요.',status:400,code:'SIGNUP_INVALID_EMAIL'};
  if(['over_email_send_rate_limit','over_request_rate_limit'].includes(code)||error?.status===429||/email.*rate limit/i.test(text))return {message:'이메일 발송 요청이 많습니다. 잠시 후 다시 시도해 주세요.',status:429,code:'SIGNUP_EMAIL_RATE_LIMIT'};
  return {message:'회원가입 서버 연결을 확인해 주세요.',status:503,code:'SIGNUP_SERVER_ERROR'};
}
export function googleLinkFailure(error:any){
  if(error?.code==='manual_linking_disabled'||/manual.*link.*disabled|manual.*link.*not enabled/i.test(error?.message??''))return '현재 서비스에서 Google 계정 연결이 비활성화되어 있습니다. 관리자에게 Supabase의 수동 계정 연결 설정(Enable manual linking)을 확인해 달라고 요청하세요. 기존 로그인은 계속 이용할 수 있습니다.';
  if(['identity_already_exists','email_exists'].includes(error?.code))return '이 Google 계정은 이미 연결되어 있습니다. 기존 연결 상태를 확인하거나 연결된 계정으로 로그인해 주세요.';
  if(error?.status===429)return 'Google 계정 연결 요청이 많습니다. 잠시 후 다시 시도해 주세요.';
  return 'Google 계정을 연결하지 못했습니다. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.';
}
