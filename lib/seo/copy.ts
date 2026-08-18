import { getDictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/config";
import {
  PUBLIC_CONTACT_EMAIL,
  type PublicIndexablePath,
} from "@/lib/seo/indexing";

export type PublicPageSeoCopy = {
  title: string;
  description: string;
};

export type PublicSeoCopy = {
  siteName: string;
  ogImageAlt: string;
  pages: Record<PublicIndexablePath, PublicPageSeoCopy>;
};

export function getPublicSeoCopy(locale: Locale): PublicSeoCopy {
  const dictionary = getDictionary(locale);
  const siteName = dictionary.publicHome.productName;

  if (locale === "ru") {
    return {
      siteName,
      ogImageAlt: `${siteName} — учебные переговоры с AI-разбором`,
      pages: {
        "/": {
          title: `${siteName} — учебные переговоры с AI-разбором`,
          description: dictionary.publicHome.heroBody1,
        },
        "/about": {
          title: dictionary.publicAbout.title,
          description: `${siteName}: страница об авторе ${dictionary.publicAbout.authorName}. Платформа для учебных переговоров с записью, транскриптом и ИИ-разбором как дополнительным материалом для практики.`,
        },
        "/faq": {
          title: dictionary.publicFaq.title,
          description: `Частые вопросы о ${siteName}: учебные кейсы, роли, запись сессий, транскрипт и ИИ-разбор.`,
        },
        "/support": {
          title: dictionary.publicSupport.title,
          description: `Поддержка ${siteName}. Напишите на ${PUBLIC_CONTACT_EMAIL} по работе платформы, персональным данным и сотрудничеству.`,
        },
      },
    };
  }

  return {
    siteName,
    ogImageAlt: `${siteName} — training negotiations with AI review`,
    pages: {
      "/": {
        title: `${siteName} — training negotiations with AI review`,
        description: dictionary.publicHome.heroBody1,
      },
      "/about": {
        title: dictionary.publicAbout.title,
        description: `${siteName}: about the author, ${dictionary.publicAbout.authorName}. A platform for training negotiations with recording, transcript, and AI review as additional material for practice.`,
      },
      "/faq": {
        title: dictionary.publicFaq.title,
        description: `Frequently asked questions about ${siteName}: training cases, roles, session recording, transcript, and AI review.`,
      },
      "/support": {
        title: dictionary.publicSupport.title,
        description: `${siteName} support. Contact ${PUBLIC_CONTACT_EMAIL} about the platform, personal data, and collaboration.`,
      },
    },
  };
}
