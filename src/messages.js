/* eslint-disable no-prototype-builtins */
const Attributes = require('./attributes');

class Messages {
  constructor(lang, messages) {
    this.lang = lang;
    this.messages = messages;
    this.customMessages = {};
    this.attributeNames = {};
  }

  /**
   * Set custom messages
   *
   * @param {object} customMessages
   * @return {void}
   */
  _setCustom(customMessages) {
    this.customMessages = customMessages || {};
  }

  /**
   * Set custom attribute names.
   *
   * @param {object} attributes
   */
  _setAttributeNames(attributes) {
    this.attributeNames = attributes;
  }

  /**
   * Set the attribute formatter.
   *
   * @param {fuction} func
   * @return {void}
   */
  _setAttributeFormatter(func) {
    this.attributeFormatter = func;
  }

  /**
   * Get attribute name to display.
   *
   * @param  {string} attribute
   * @return {string}
   */
  _getAttributeName(attribute) {
    let name = attribute;
    if (this.attributeNames.hasOwnProperty(attribute)) {
      return this.attributeNames[attribute];
    } else if (this.messages.attributes.hasOwnProperty(attribute)) {
      name = this.messages.attributes[attribute];
    }

    if (this.attributeFormatter) {
      name = this.attributeFormatter(name);
    }

    return name;
  }

  /**
   * Get all messages
   *
   * @return {object}
   */
  all() {
    return this.messages;
  }

  /**
   * Render message
   *
   * @param  {Rule} rule
   * @return {string}
   */
  render(rule) {
    if (rule.customMessage) {
      return rule.customMessage;
    }
    const template = this._getTemplate(rule);

    let message;
    if (Attributes.replacements[rule.name]) {
      message = Attributes.replacements[rule.name].apply(this, [template, rule]);
    } else {
      message = this._replacePlaceholders(rule, template, {});
    }

    return message;
  }

  /**
   * Get the template to use for given rule
   *
   * @param  {Rule} rule
   * @return {string}
   */
  _getTemplate(rule) {
    const messages = this.messages;
    let template = messages.def;
    const customMessages = this.customMessages;
    const formats = [rule.name + '.' + rule.attribute, rule.name];

    for (let i = 0, format; i < formats.length; i++) {
      format = formats[i];
      if (customMessages.hasOwnProperty(format)) {
        template = customMessages[format];
        break;
      } else if (messages.hasOwnProperty(format)) {
        template = messages[format];
        break;
      }
    }

    if (typeof template === 'object') {
      template = template[rule._getValueType()];
    }

    return template;
  }

  /**
   * Replace placeholders in the template using the data object
   *
   * @param  {Rule} rule
   * @param  {string} template
   * @param  {object} data
   * @return {string}
   */
  _replacePlaceholders(rule, template, data) {
    let message, attribute;

    data.attribute = this._getAttributeName(rule.attribute);
    data[rule.name] = data[rule.name] || rule.getParameters().join(',');

    if (typeof template === 'string' && typeof data === 'object') {
      message = template;

      for (attribute in data) {
        message = message.replace(new RegExp(':' + attribute, 'g'), data[attribute]);
      }
    }

    return message;
  }
}

module.exports = Messages;
