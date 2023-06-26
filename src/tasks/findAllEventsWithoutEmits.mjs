import { allVueFiles, iterateFiles } from '../utils.mjs';
import {
  enterComponentDefinition,
  getComponentOption,
  resolveComponentStruct,
  traverse
} from '../selection.mjs';
import { replaceContent } from '../transform.mjs';

export const findAllEventsWithoutEmits = () => {
  const sources = allVueFiles();

  return iterateFiles(sources, (file) => {
    const { name } = file;
    const component = resolveComponentStruct(file);
    const eventsSet = new Set();
    [
      component.template?.content,
      component.script?.content,
    ]
      .filter(Boolean)
      .forEach(componentPart => {
        const matches = componentPart.matchAll(/\$emit\((.*)\)/gm);
        if (matches) {
          for (const match of matches) {
            console.log(match[0]);
            traverse(match[0], {
              CallExpression(path) {
                const { node } = path;
                node.arguments.forEach(arg => {
                  if (arg.type === 'StringLiteral') {
                    eventsSet.add(arg.value);
                  }
                });
              }
            });
          }
        }
      });

    if (!component.script) {
      if (eventsSet.size) {
        const serializedEventsList = [...eventsSet].map(e => `'${e}'`).join(', ');
        console.log(`No script for: ${component.template.file}, events: ${serializedEventsList}`);
      }
      return;
    }

    enterComponentDefinition(component.script.program, (node) => {
      const emits = getComponentOption(node, 'emits');
      if (emits) {
        eventsSet.forEach(event => {
          if (emits.value.elements.some(eventName => eventName.value === event)) {
            eventsSet.delete(event);
          }
        });
      }

      if (eventsSet.size) {
        const serializedEventsList = [...eventsSet].map(e => `'${e}'`).join(', ');
        console.log(name, serializedEventsList);

        if (emits) {
          const lastElementPosition = emits.value.elements.at(-1).end + component.script.offset;
          replaceContent(component.script.file, lastElementPosition, lastElementPosition, serializedEventsList);
        } else {
          const insertPosition = [
            getComponentOption(node, 'name'),
            getComponentOption(node, 'components'),
            getComponentOption(node, 'props'),
          ].filter(Boolean).at(-1).end + component.script.offset + 1;
          const emitsOption = `\n  emits: [${serializedEventsList}],`;
          replaceContent(component.script.file, insertPosition, insertPosition, emitsOption);
        }
      }
    });
  });
};
