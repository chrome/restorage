import Immutable from 'immutable'
import Cursor from 'immutable/contrib/cursor'
import shallowequal from 'shallowequal'

import React from 'react'
import uniqueId from 'lodash/uniqueId'
import isObject from 'lodash/isObject'
import isFunction from 'lodash/isFunction'
import toPath from 'lodash/toPath'

export default class Restorage {
  constructor(initialData = {}) {
    this.__bindedMethods = []
    this.__connectedComponents = {}
    this.__handleStoreUpdate(Immutable.fromJS(initialData))
    this.connect = this.connect.bind(this)
  }

  __addUpdateListener(scheme, wrapper, callback) {
    const id = uniqueId()
    this.__connectedComponents[id] = {scheme, wrapper, callback}
    return id
  }

  __removeUpdateListener(id) {
    delete this.__connectedComponents[id]
  }

  __handleStoreUpdate(newStore) {
    const prevStore = this.__store
    this.__store = newStore
    this.__cursor = Cursor.from(newStore, [], this.__handleStoreUpdate.bind(this))
    this.__restoreMethods()
    this.__bindMethods(this.__cursor)

    Object.keys(this.__connectedComponents).forEach((id) => {
      if (this.__connectedComponents[id]) {
        const {scheme: dirtyScheme, wrapper, callback} = this.__connectedComponents[id]
        const scheme = this.__cleanScheme(dirtyScheme, wrapper.props)
        if (this.__subsetChanged(scheme, prevStore)) {
          callback(this.__getSubSet(scheme))
        }
      }
    })
  }

  __cleanScheme(scheme, props) {
    return isFunction(scheme) ? scheme(props) : scheme
  }

  __restoreMethods() {
    if (this.__bindedMethods) {
      this.__bindedMethods.forEach((method) => delete this[method])
      this.__bindedMethods = []
    }
  }

  __bindMethods(store) {
    for (const key in store) {
      if (isFunction(store[key]) && key[0] !== '_' && key !== 'constructor') {
        this.__bindedMethods.push(key)
        this[key] = store[key].bind(store)
      }
    }
  }

  __getValue(store, path) {
    return path === '*' ? store : store.getIn(toPath(path))
  }

  __getJSValue(store, path) {
    const value = this.__getValue(store, path)
    return (value && value.toJS) ? value.toJS() : value
  }

  __subsetChanged(scheme, newStore) {
    return !!Object.keys(scheme).find((key) => {
      return this.__getValue(this.__store, scheme[key]) !== this.__getValue(newStore, scheme[key])
    })
  }

  __getSubSet(scheme) {
    return Object.keys(scheme).reduce((result, key) => {
      if (key === '*') {
        const value = this.__getJSValue(this.__store, scheme[key])
        if (isObject(value)) {
          return Object.assign(result, this.__getJSValue(this.__store, scheme[key]))
        } else {
          // console.warn('Scheme warning: "*" is linked to non object (ignored).')
          return result
        }
      } else {
        return Object.assign(result, {[key]: this.__getJSValue(this.__store, scheme[key])})
      }
    }, {})
  }


  __decorate(Component, scheme, store = this) {
    return class ConnectedComponent extends React.Component {
      _updateStore() {
        this.store = store.__getSubSet(store.__cleanScheme(scheme, this.props))
      }

      componentWillMount() {
        this.useDynamicScheme = isFunction(scheme)
        this.storeListenerId = store.__addUpdateListener(scheme, this, () => {
          this._updateStore()
          this.forceUpdate()
        })
        this._updateStore()
      }

      componentWillReceiveProps(nextProps) {
        if (this.useDynamicScheme) {
          this.store = store.__getSubSet(store.__cleanScheme(scheme, nextProps))
        }
      }

      componentWillUnmount() {
        store.__removeUpdateListener(this.storeListenerId)
      }

      shouldComponentUpdate(nextProps) {
        return !shallowequal(this.props, nextProps)
      }

      render() {
        return (
          <Component {...this.props} {...this.store}/>
        )
      }
    }
  }


  connect() {
    const defaultScheme = {'*': '*'}
    if (arguments.length === 1 && !(arguments[0].prototype && arguments[0].prototype.render)) {
      // Used as decorator with params
      const [scheme] = arguments
      return ((Component) => this.__decorate(Component, scheme || defaultScheme, this))
    } else {
      // Used as method or as decorator with default schema
      const [Component, scheme] = arguments
      return this.__decorate(Component, scheme || defaultScheme, this)
    }
  }
}
