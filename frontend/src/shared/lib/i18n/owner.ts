import ukOwner from 'virtual:uk-owner';
import { i18n } from './index';

/**
 * Registers the owner-only Ukrainian strings (`owner-namespaces.ts`). Called once by the
 * owner chunk (`app/owner-pages.ts`) as it loads, before any owner screen renders — so
 * this module, and the strings it carries, never reach an operator's first load.
 */
export function addOwnerTranslations(): void {
  i18n.addResourceBundle('uk', 'translation', ukOwner, true, false);
}
