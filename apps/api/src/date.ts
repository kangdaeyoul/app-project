import { BadRequestException } from '@nestjs/common';
export function seoulToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function validateMonth(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000')) throw new BadRequestException('month는 YYYY-MM 형식이어야 합니다.');
  return month;
}
export function overlapsMonth(site: { startDate: string; endDate: string }, month: string): boolean {
  return site.startDate.slice(0, 7) <= month && (site.endDate || site.startDate).slice(0, 7) >= month;
}
