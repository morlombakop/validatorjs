const Rules = require('./rules');
const Lang = require('./lang');
const Errors = require('./errors');
const Attributes = require('./attributes');
const AsyncResolvers = require('./async');

class Validator {
  constructor(input, rules, customMessages) {
    this.lang = 'en';
    this.numericRules = ['integer', 'numeric'];
    this.attributeFormatter = Attributes.formatter;
    const lang = this.constructor.getDefaultLang();
    this.input = input || {};

    this.messages = Lang._make(lang);
    this.messages._setCustom(customMessages);
    this.setAttributeFormatter(this.attributeFormatter);

    this.errors = new Errors();
    this.errorCount = 0;

    this.hasAsync = false;
    this.rules = this._parseRules(rules);
  }

  /**
   * Run validator
   *
   * @return {boolean} Whether it passes; true = passes, false = fails
   */
  check() {
    for (const attribute in this.rules) {
      const attributeRules = this.rules[attribute];
      const inputValue = this._objectPath(this.input, attribute);

      if (this._hasRule(attribute, ['sometimes']) && !this._suppliedWithData(attribute)) {
        continue;
      }

      for (let i = 0, len = attributeRules.length, rule, ruleOptions, rulePassed; i < len; i++) {
        ruleOptions = attributeRules[i];
        rule = this.getRule(ruleOptions.name);

        if (!this._isValidatable(rule, inputValue)) {
          continue;
        }

        rulePassed = rule.validate(inputValue, ruleOptions.value, attribute);
        if (!rulePassed) {
          this._addFailure(rule);
        }

        if (this._shouldStopValidating(attribute, rulePassed)) {
          break;
        }
      }
    }

    return this.errorCount === 0;
  }

  /**
   * Run async validator
   *
   * @param {function} passes
   * @param {function} fails
   * @return {void}
   */
  checkAsync(passes, fails) {
    const _this = this;
    passes = passes || function () { };
    fails = fails || function () { };

    const failsOne = function (rule, message) {
      _this._addFailure(rule, message);
    };

    const resolvedAll = function (allPassed) {
      if (allPassed) {
        passes();
      } else {
        fails();
      }
    };

    const asyncResolvers = new AsyncResolvers(failsOne, resolvedAll);

    const validateRule = function (inputValue, ruleOptions, attribute, rule) {
      return function () {
        const resolverIndex = asyncResolvers.add(rule);
        rule.validate(inputValue, ruleOptions.value, attribute, function () {
          asyncResolvers.resolve(resolverIndex);
        });
      };
    };

    for (let attribute in this.rules) {
      const attributeRules = this.rules[attribute];
      const inputValue = this._objectPath(this.input, attribute);

      if (this._hasRule(attribute, ['sometimes']) && !this._suppliedWithData(attribute)) {
        continue;
      }

      for (let i = 0, len = attributeRules.length, rule, ruleOptions; i < len; i++) {
        ruleOptions = attributeRules[i];

        rule = this.getRule(ruleOptions.name);

        if (!this._isValidatable(rule, inputValue)) {
          continue;
        }

        validateRule(inputValue, ruleOptions, attribute, rule)();
      }
    }

    asyncResolvers.enableFiring();
    asyncResolvers.fire();
  }

  /**
   * Add failure and error message for given rule
   *
   * @param {Rule} rule
   */
  _addFailure(rule) {
    const msg = this.messages.render(rule);
    this.errors.add(rule.attribute, msg);
    this.errorCount++;
  }

  /**
   * Flatten nested object, normalizing { foo: { bar: 1 } } into: { 'foo.bar': 1 }
   *
   * @param  {object} nested object
   * @return {object} flattened object
   */
  _flattenObject(obj) {
    const flattened = {};

    function recurse(current, property) {
      if (!property && Object.getOwnPropertyNames(current).length === 0) {
        return;
      }
      if (Object(current) !== current || Array.isArray(current)) {
        flattened[property] = current;
      } else {
        let isEmpty = true;
        for (const p in current) {
          isEmpty = false;
          recurse(current[p], property ? property + '.' + p : p);
        }
        if (isEmpty) {
          flattened[property] = {};
        }
      }
    }
    if (obj) {
      recurse(obj);
    }
    return flattened;
  }

  /**
   * Extract value from nested object using string path with dot notation
   *
   * @param  {object} object to search in
   * @param  {string} path inside object
   * @return {any|void} value under the path
   */
  _objectPath(obj, path) {
    if (Object.prototype.hasOwnProperty.call(obj, path)) {
      return obj[path];
    }

    const keys = path.replace(/\[(\w+)\]/g, '.$1').replace(/^\./, '').split('.');
    let copy = {};
    for (const attr in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, attr)) {
        copy[attr] = obj[attr];
      }
    }

    for (let i = 0, l = keys.length; i < l; i++) {
      if (typeof copy === 'object' && copy !== null && Object.hasOwnProperty.call(copy, keys[i])) {
        copy = copy[keys[i]];
      } else {
        return;
      }
    }
    return copy;
  }

  /**
   * Parse rules, normalizing format into: { attribute: [{ name: 'age', value: 3 }] }
   *
   * @param  {object} rules
   * @return {object}
   */
  _parseRules(_rules) {
    const parsedRules = {};
    const rules = this._flattenObject(_rules);

    for (let attribute in rules) {
      const rulesArray = rules[attribute];
      this._parseRulesCheck(attribute, rulesArray, parsedRules);
    }

    return parsedRules;
  }

  _parseRulesCheck(attribute, rulesArray, parsedRules, wildCardValues) {
    if (attribute.indexOf('*') > -1) {
      this._parsedRulesRecurse(attribute, rulesArray, parsedRules, wildCardValues);
    } else {
      this._parseRulesDefault(attribute, rulesArray, parsedRules, wildCardValues);
    }
  }

  _parsedRulesRecurse(attribute, rulesArray, parsedRules, wildCardValues) {
    const parentPath = attribute.substr(0, attribute.indexOf('*') - 1);
    const propertyValue = this._objectPath(this.input, parentPath);

    if (propertyValue) {
      for (let propertyNumber = 0; propertyNumber < propertyValue.length; propertyNumber++) {
        const workingValues = wildCardValues ? wildCardValues.slice() : [];
        workingValues.push(propertyNumber);
        this._parseRulesCheck(attribute.replace('*', propertyNumber), rulesArray, parsedRules, workingValues);
      }
    }
  }

  _parseRulesDefault(attribute, rulesArray, parsedRules, wildCardValues) {
    const attributeRules = [];

    if (rulesArray instanceof Array) {
      rulesArray = this._prepareRulesArray(rulesArray);
    }

    if (typeof rulesArray === 'string') {
      rulesArray = rulesArray.split('|');
    }

    for (let i = 0, len = rulesArray.length, rule; i < len; i++) {
      rule = typeof rulesArray[i] === 'string' ? this._extractRuleAndRuleValue(rulesArray[i]) : rulesArray[i];
      if (rule.value) {
        rule.value = this._replaceWildCards(rule.value, wildCardValues);
        this._replaceWildCardsMessages(wildCardValues);
      }

      if (Rules.isAsync(rule.name)) {
        this.hasAsync = true;
      }
      attributeRules.push(rule);
    }

    parsedRules[attribute] = attributeRules;
  }

  _replaceWildCards(path, nums) {

    if (!nums) {
      return path;
    }

    let path2 = path;
    nums.forEach(function (value) {
      if (Array.isArray(path2)) {
        path2 = path2[0];
      }
      const pos = path2.indexOf('*');
      if (pos === -1) {
        return path2;
      }
      path2 = path2.substr(0, pos) + value + path2.substr(pos + 1);
    });
    if (Array.isArray(path)) {
      path[0] = path2;
      path2 = path;
    }
    return path2;
  }

  _replaceWildCardsMessages(nums) {
    const customMessages = this.messages.customMessages;
    let self = this;
    Object.keys(customMessages).forEach(function (key) {
      if (nums) {
        const newKey = self._replaceWildCards(key, nums);
        customMessages[newKey] = customMessages[key];
      }
    });

    this.messages._setCustom(customMessages);
  }
  /**
   * Prepare rules if it comes in Array. Check for objects. Need for type validation.
   *
   * @param  {array} rulesArray
   * @return {array}
   */
  _prepareRulesArray(rulesArray) {
    const rules = [];

    for (let i = 0, len = rulesArray.length; i < len; i++) {
      if (typeof rulesArray[i] === 'object') {
        for (let rule in rulesArray[i]) {
          rules.push({
            name: rule,
            value: rulesArray[i][rule]
          });
        }
      } else {
        rules.push(rulesArray[i]);
      }
    }

    return rules;
  }

  /**
   * Determines if the attribute is supplied with the original data object.
   *
   * @param  {array} attribute
   * @return {boolean}
   */
  _suppliedWithData(attribute) {
    // eslint-disable-next-line no-prototype-builtins
    return this.input.hasOwnProperty(attribute);
  }

  /**
   * Extract a rule and a value from a ruleString (i.e. min:3), rule = min, value = 3
   *
   * @param  {string} ruleString min:3
   * @return {object} object containing the name of the rule and value
   */
  _extractRuleAndRuleValue(ruleString) {
    let rule = {},
      ruleArray;

    rule.name = ruleString;

    if (ruleString.indexOf(':') >= 0) {
      ruleArray = ruleString.split(':');
      rule.name = ruleArray[0];
      rule.value = ruleArray.slice(1).join(':');
    }

    return rule;
  }

  /**
   * Determine if attribute has any of the given rules
   *
   * @param  {string}  attribute
   * @param  {array}   findRules
   * @return {boolean}
   */
  _hasRule(attribute, findRules) {
    const rules = this.rules[attribute] || [];
    for (let i = 0, len = rules.length; i < len; i++) {
      if (findRules.indexOf(rules[i].name) > -1) {
        return true;
      }
    }

    return false;
  }

  /**
   * Determine if attribute has any numeric-based rules.
   *
   * @param  {string}  attribute
   * @return {Boolean}
   */
  _hasNumericRule(attribute) {
    return this._hasRule(attribute, this.numericRules);
  }

  /**
   * Determine if rule is validatable
   *
   * @param  {Rule}   rule
   * @param  {mixed}  value
   * @return {boolean}
   */
  _isValidatable(rule, value) {
    if (Array.isArray(value)) {
      return true;
    }
    if (Rules.isImplicit(rule.name)) {
      return true;
    }

    return this.getRule('required').validate(value);
  }

  /**
   * Determine if we should stop validating.
   *
   * @param  {string} attribute
   * @param  {boolean} rulePassed
   * @return {boolean}
   */
  _shouldStopValidating(attribute, rulePassed) {
    const stopOnAttributes = this.stopOnAttributes;
    if (typeof stopOnAttributes === 'undefined' || stopOnAttributes === false || rulePassed === true) {
      return false;
    }

    if (stopOnAttributes instanceof Array) {
      return stopOnAttributes.indexOf(attribute) > -1;
    }

    return true;
  }

  /**
   * Set custom attribute names.
   *
   * @param {object} attributes
   * @return {void}
   */
  setAttributeNames(attributes) {
    this.messages._setAttributeNames(attributes);
  }

  /**
   * Set the attribute formatter.
   *
   * @param {fuction} func
   * @return {void}
   */
  setAttributeFormatter(func) {
    this.messages._setAttributeFormatter(func);
  }

  /**
   * Get validation rule
   *
   * @param  {string} name
   * @return {Rule}
   */
  getRule(name) {
    return Rules.make(name, this);
  }

  /**
   * Stop on first error.
   *
   * @param  {boolean|array} An array of attributes or boolean true/false for all attributes.
   * @return {void}
   */
  stopOnError(attributes) {
    this.stopOnAttributes = attributes;
  }

  /**
   * Determine if validation passes
   *
   * @param {function} passes
   * @return {boolean|undefined}
   */
  passes(passes) {
    const async = this._checkAsync('passes', passes);
    if (async) {
      return this.checkAsync(passes);
    }
    return this.check();
  }

  /**
   * Determine if validation fails
   *
   * @param {function} fails
   * @return {boolean|undefined}
   */
  fails(fails) {
    const async = this._checkAsync('fails', fails);
    if (async) {
      return this.checkAsync(function () { }, fails);
    }
    return !this.check();
  }

  /**
   * Check if validation should be called asynchronously
   *
   * @param  {string}   funcName Name of the caller
   * @param  {function} callback
   * @return {boolean}
   */
  _checkAsync(funcName, callback) {
    const hasCallback = typeof callback === 'function';
    if (this.hasAsync && !hasCallback) {
      throw new Error(`${funcName} expects a callback when async rules are being tested.`);
    }

    return this.hasAsync || hasCallback;
  }

  /**
 * Set messages for language
 *
 * @param {string} lang
 * @param {object} messages
 * @return {this}
 */
  static setMessages(lang, messages) {
    Lang._set(lang, messages);
    return this;
  }

  /**
   * Get messages for given language
   *
   * @param  {string} lang
   * @return {Messages}
   */
  static getMessages(lang) {
    return Lang._get(lang);
  }

  /**
   * Set default language to use
   *
   * @param {string} lang
   * @return {void}
   */
  static useLang(lang) {
    this.lang = lang;
  }

  /**
   * Get default language
   *
   * @return {string}
   */
  static getDefaultLang() {
    return this.lang || 'en';
  }

  /**
   * Set the attribute formatter.
   *
   * @param {fuction} func
   * @return {void}
   */
  static setAttributeFormatter(func) {
    this.attributeFormatter = func;
  }

  /**
   * Stop on first error.
   *
   * @param  {boolean|array} An array of attributes or boolean true/false for all attributes.
   * @return {void}
   */
  static stopOnError(attributes) {
    this.stopOnAttributes = attributes;
  }

  /**
   * Register custom validation rule
   *
   * @param  {string}   name
   * @param  {function} fn
   * @param  {string}   message
   * @return {void}
   */
  static register(name, fn, message, fnReplacement) {
    const lang = this.getDefaultLang();
    Rules.register(name, fn);
    Lang._setRuleMessage(lang, name, message);
  }

  /**
   * Register custom validation rule
   *
   * @param  {string}   name
   * @param  {function} fn
   * @param  {string}   message
   * @param  {function} fnReplacement
   * @return {void}
   */
  static registerImplicit(name, fn, message, fnReplacement) {
    const lang = this.getDefaultLang();
    Rules.registerImplicit(name, fn);
    Lang._setRuleMessage(lang, name, message);
  }

  /**
   * Register asynchronous validation rule
   *
   * @param  {string}   name
   * @param  {function} fn
   * @param  {string}   message
   * @return {void}
   */
  static registerAsync(name, fn, message, fnReplacement) {
    const lang = this.getDefaultLang();
    Rules.registerAsync(name, fn);
    Lang._setRuleMessage(lang, name, message);
  }

  /**
   * Register asynchronous validation rule
   *
   * @param  {string}   name
   * @param  {function} fn
   * @param  {string}   message
   * @return {void}
   */
  static registerAsyncImplicit(name, fn, message) {
    const lang = this.getDefaultLang();
    Rules.registerAsyncImplicit(name, fn);
    Lang._setRuleMessage(lang, name, message);
  }

  /**
   * Register validator for missed validation rule
   *
   * @param  {string}   name
   * @param  {function} fn
   * @param  {string}   message
   * @return {void}
   */
  static registerMissedRuleValidator(fn, message) {
    Rules.registerMissedRuleValidator(fn, message);
  }
}


module.exports = Validator;
