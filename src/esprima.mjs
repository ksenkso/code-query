import jsdom from 'jsdom';

export const findInTemplate = (templateContent, selector) => {
  const dom = new jsdom.JSDOM(templateContent);

  return {
    dom,
    result: dom.window.document.body.querySelector(selector),
  };
}
