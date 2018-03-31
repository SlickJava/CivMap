import { circleBoundsFromFeatureGeometry, circleToBounds } from './math'
import { getJSON } from './net'
import { openFeatureDetail, setActiveBasemap, setViewport, loadFeatures, addFeature } from '../store'

export function loadAppStateFromUrlData(urlData, store) {
  if (urlData.basemap) {
    store.dispatch(setActiveBasemap(urlData.basemap))
  }
  if (urlData.collectionUrl) {
    loadCollectionJsonAsync(urlData.collectionUrl, store.dispatch, loadDependentThings)
  } else {
    loadDependentThings()
  }
  function loadDependentThings(data, error) {
    if (error) {
      // TODO handle error
    }
    // TODO move into view if collectionUrl but no viewport is set
    if (urlData.collection) {
      // TODO move into view if no viewport is set
      loadCollectionJson(urlData.collection, store, '#')
    }
    if (urlData.feature) {
      store.dispatch(addFeature(urlData.feature))
      urlData.featureId = urlData.feature.id
    }
    if (urlData.featureId) {
      const feature = store.getState().features[urlData.featureId]
      if (feature) {
        store.dispatch(openFeatureDetail(urlData.featureId))
        if (!urlData.viewport) {
          const viewport = circleBoundsFromFeatureGeometry(feature.geometry)
          store.dispatch(setViewport(viewport))
        }
      } else {
        // TODO handle error
      }
    }
    if (urlData.viewport) {
      store.dispatch(setViewport(urlData.viewport))
    }
  }
}

export function loadCollectionJsonAsync(url, dispatch, cb) {
  getJSON(url,
    data => {
      loadCollectionJson(data, dispatch, url)
      cb && cb(null, data)
    },
    err => {
      console.error("Could not load collection from " + url, err)
      cb && cb(err)
    }
  )
}

export function loadCollectionJson(data, dispatch, source) {
  // TODO fallback for old versions (1.0.0: layers)
  if (!data.info || data.info.version !== '2.0.0') {
    alert(`Can't read Collection version ${data.version}, only 2.0.0 please`)
    return
  }
  data = { ...data }
  if (!data.features) data.features = []
  if (!data.filters) data.filters = []

  dispatch(loadFeatures(data.features))
  // dispatch(addFilters(data.filters))
  // dispatch(enableFilters(data.enabledFilters))

  console.log('Loaded collection with', data.features.length, 'features and',
    data.filters.length, 'filters from', source)
}

export function parseUrlHash(hash) {
  const urlData = {
    basemap: undefined,
    viewport: undefined,
    collectionUrl: undefined,
    featureId: undefined,
    feature: undefined,
    collection: undefined,
  }
  if (!hash) return urlData

  // backwards compatibility
  const oldUrlMatch = hash.match(/^#([-0-9]+)x?\/([-0-9]+)z?\/?([-0-9]*)/)
  if (oldUrlMatch) {
    const [x, z, zoom = 0] = oldUrlMatch.slice(1).map(parseFloat)
    const radius = Math.pow(2, -zoom) * 500 // arbitrary, the old urls didn't track the actual radius
    urlData.viewport = circleToBounds({ x, z, radius })
    return urlData
  }

  hash.slice(1).split('#').map(part => {
    const [key, val] = part.split('=', 2)
    if (key == 'c') {
      let [x, z, radius] = val.split(/[,r]+/, 3).map(parseFloat)
      if (!radius) urlData.marker = true
      radius = radius || 100
      urlData.viewport = { x, z, radius }
    }
    else if (key == 'b') urlData.basemap = val
    else if (key == 't') urlData.basemap = val
    else if (key == 'f') urlData.featureId = val
    else if (key == 'feature') urlData.feature = JSON.parse(decodeURI(val))
    else if (key == 'collection') urlData.collection = JSON.parse(decodeURI(val))
    else if (key == 'u') urlData.collectionUrl = val
    else console.error("Unknown url hash entry", part)
  })

  return urlData
}

export function getFileProcessor(fileName) {
  if (fileName === 'Snitches.csv') {
    return { process: processSnitchMasterFile, description: 'SnitchMaster snitches' }
  } else if (fileName.endsWith('.civmap.json')) {
    return { process: processCollectionFile, description: 'CivMap Collection' }
  } else if (fileName.endsWith('.points')) {
    return { process: processVoxelWaypointsFile, description: 'VoxelMap waypoints' }
  } else if (/([-0-9]+),([-0-9]+)\.png/.test(fileName)) {
    return { process: processJourneyTileFile, description: 'JourneyMap tile' }
  }
}

export function processJourneyTileFile(file, dispatch) {
  const reader = new FileReader()
  reader.onload = (eventRead) => {
    const imgUrl = eventRead.target.result

    const [_fullMatch, ix, iz] = file.name.match(/([-0-9]+),([-0-9]+)\.png/)
    const n = parseInt(iz) * 512
    const w = parseInt(ix) * 512
    const s = n + 512
    const e = w + 512

    const fid = `dragdrop-journeymap-tile-${ix}-${iz}`

    dispatch(addFeature({
      id: fid,
      geometry: {
        type: "image",
        url: imgUrl,
        bounds: [[n, w], [s, e]],
      },
      properties: {
        is_journeymap_tile: true,
        name: fid,
      },
    }))
  }
  reader.readAsDataURL(file)
}

export function processCollectionFile(file, dispatch) {
  const reader = new FileReader()
  reader.onload = (eventRead) => {
    const text = eventRead.target.result
    const json = JSON.parse(text)
    loadCollectionJson(json, dispatch, 'drag-drop')
  }
  reader.readAsText(file)
}

export function processVoxelWaypointsFile(file, dispatch) {
  const reader = new FileReader()
  reader.onload = (eventRead) => {
    const text = eventRead.target.result

    // name, x, z, y, enabled, red, green, blue, suffix, world, dimensions
    const features = text.split('\n')
      .filter(line => line.includes('x:'))
      .map(line => {
        const p = {}
        line.split(',').map(entry => {
          const [key, val] = entry.split(':')
          p[key] = val
        })
        p.x = parseInt(p.x)
        p.y = parseInt(p.y)
        p.z = parseInt(p.z)
        p.red = parseFloat(p.red)
        p.green = parseFloat(p.green)
        p.blue = parseFloat(p.blue)
        p.enabled = p.enabled == 'true'

        const fid = `dragdrop-voxelmap-waypoint-${p.x},${p.y},${p.z},${p.name}`
        const color = `rgb(${Math.round(p.red * 255)},${Math.round(p.green * 255)},${Math.round(p.blue * 255)})`

        return {
          id: fid,
          geometry: {
            type: "marker",
            position: [p.z, p.x],
          },
          style: { circle_marker: { radius: 4, weight: 0, fillColor: color, color } },
          properties: {
            ...p,
            is_voxelmap_waypoint: true,
            is_waypoint: true,
          },
        }
      })

    dispatch(loadFeatures(features))

    // TODO create+enable preconfigured waypoints filter
  }
  reader.readAsText(file)
}

export function processSnitchMasterFile(file, dispatch) {
  const reader = new FileReader()
  reader.onload = (eventRead) => {
    const text = eventRead.target.result

    const features = text.split('\n')
      .filter(line => line) // skip empty
      .map(line => {
        let [x, y, z, world, source, group, name, cull] = line.split(',')
        x = parseInt(x)
        y = parseInt(y)
        z = parseInt(z)
        cull = parseFloat(cull)

        const fid = `dragdrop-snitchmaster-${x},${y},${z},${group}`

        // TODO colorize groups

        return {
          id: fid,
          geometry: {
            type: "polygon",
            positions: [[z - 11, x - 11], [z + 12, x - 11], [z + 12, x + 12], [z - 11, x + 12]],
          },
          properties: {
            is_snitch: true,
            from_snitchmaster: true,
            x, y, z, world, source, group, name, cull,
          },
        }
      })

    dispatch(loadFeatures(features))

    // TODO create+enable preconfigured snitchmaster filter
  }
  reader.readAsText(file)
}
