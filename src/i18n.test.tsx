import {describe, expect, it} from 'vitest';
import {translateText} from './i18n';

describe('KAYRO bilingual interface translations',()=>{
  it('translates navigation labels for English',()=>{
    expect(translateText('نمای کلی','en')).toBe('Overview');
    expect(translateText('پروژه‌ها','en')).toBe('Projects');
    expect(translateText('وظایف','en')).toBe('Tasks');
    expect(translateText('گزارش فعالیت','en')).toBe('Activity log');
  });

  it('keeps Persian labels unchanged in Persian mode',()=>{
    expect(translateText('نمای کلی','fa')).toBe('نمای کلی');
    expect(translateText('خروج امن','fa')).toBe('خروج امن');
  });

  it('translates dynamic model counts',()=>{
    expect(translateText('12 مدل رایگان در دسترس','en')).toBe('12 free models available');
    expect(translateText('اتصال موفق؛ 3 مدل رایگان یافت شد.','en')).toBe('Connected successfully; 3 free models found.');
  });

  it('translates dynamic delete confirmations without losing the item name',()=>{
    expect(translateText('وظیفهٔ «Review deployment» حذف شود؟','en')).toBe('Delete task “Review deployment”?');
    expect(translateText('یادداشت «Release notes» برای همیشه حذف شود؟','en')).toBe('Permanently delete note “Release notes”?');
  });

  it('leaves custom user text alone rather than guessing a translation',()=>{
    expect(translateText('my private project title','en')).toBe('my private project title');
  });
});
