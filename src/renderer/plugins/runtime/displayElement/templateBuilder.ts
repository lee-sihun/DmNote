/**
 * 디스플레이 요소 템플릿 빌더
 * 플러그인에서 사용하는 템플릿 관련 유틸리티를 제공합니다.
 */

import { html, styleMap, css } from '@utils/templateEngine';
import type {
  DisplayElementTemplate,
  DisplayElementTemplateFactoryValue,
  DisplayElementTemplateHelpers,
  DisplayElementTemplateValueResolver,
} from '@src/types/api';

type CompiledTemplateChunk =
  | { type: 'fn'; fn: DisplayElementTemplateValueResolver }
  | { type: 'value'; value: DisplayElementTemplateFactoryValue };

export const displayElementTemplateHelpers: DisplayElementTemplateHelpers = {
  html,
  styleMap,
  css,
  locale: 'ko',
  t: (key) => key,
};

/**
 * 템플릿 팩토리 함수를 생성합니다.
 * 태그드 템플릿 리터럴 형식으로 사용됩니다.
 */
export const buildDisplayElementTemplate = (
  strings: TemplateStringsArray,
  ...values: DisplayElementTemplateFactoryValue[]
): DisplayElementTemplate => {
  const compiledChunks: CompiledTemplateChunk[] = values.map((value) =>
    typeof value === 'function'
      ? { type: 'fn', fn: value as DisplayElementTemplateValueResolver }
      : { type: 'value', value },
  );

  return (state, helpers = displayElementTemplateHelpers) => {
    const resolvedValues = compiledChunks.map((chunk) => {
      if (chunk.type === 'fn') {
        try {
          return chunk.fn(state, helpers);
        } catch (error) {
          console.error(
            '[UI API] displayElement.template value resolver failed',
            error,
          );
          return '';
        }
      }
      return chunk.value;
    });

    return helpers.html(strings, ...resolvedValues);
  };
};
