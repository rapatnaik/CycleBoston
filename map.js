// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoicmFwYXRuYWlrIiwiYSI6ImNtYW9qam9rdzA3dWUya3B3NjF4MnlpeTkifQ.1mZzGkAWkFyK-GX1-c3Z8A';

const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

// step 5.4
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

let timeFilter = -1;

function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes);
    return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function computeStationTraffic(stations, trips) {
    // Retrieve filtered trips efficiently
    const departures = d3.rollup(
        filterByMinute(departuresByMinute, timeFilter), // Efficient retrieval
        (v) => v.length,
        (d) => d.start_station_id
    );

    const arrivals = d3.rollup(
        filterByMinute(arrivalsByMinute, timeFilter), // Efficient retrieval
        (v) => v.length,
        (d) => d.end_station_id
    );
  
    return stations.map((station) => {
      const id = station.short_name;
      station.arrivals = arrivals.get(id) ?? 0;
      station.departures = departures.get(id) ?? 0;
      station.totalTraffic = station.arrivals + station.departures;
      return station;
    });
}
  

function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

function filterTripsbyTime(trips, timeFilter) {
    return timeFilter === -1
      ? trips // If no filter is applied (-1), return all trips
      : trips.filter((trip) => {
          // Convert trip start and end times to minutes since midnight
          const startedMinutes = minutesSinceMidnight(trip.started_at);
          const endedMinutes = minutesSinceMidnight(trip.ended_at);
  
          // Include trips that started or ended within 60 minutes of the selected time
          return (
            Math.abs(startedMinutes - timeFilter) <= 60 ||
            Math.abs(endedMinutes - timeFilter) <= 60
          );
        });
}

function filterByMinute(tripsByMinute, minute) {
    if (minute === -1) {
      return tripsByMinute.flat(); // No filtering, return all trips
    }
  
    // Normalize both min and max minutes to the valid range [0, 1439]
    let minMinute = (minute - 60 + 1440) % 1440;
    let maxMinute = (minute + 60) % 1440;
  
    // Handle time filtering across midnight
    if (minMinute > maxMinute) {
      let beforeMidnight = tripsByMinute.slice(minMinute);
      let afterMidnight = tripsByMinute.slice(0, maxMinute);
      return beforeMidnight.concat(afterMidnight).flat();
    } else {
      return tripsByMinute.slice(minMinute, maxMinute).flat();
    }
}


map.on('load', async () => {
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
    });

    map.addLayer({
        id: 'bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: {
            'line-color': '#32D400',  // A bright green using hex code
            'line-width': 3,          // Thicker lines
            'line-opacity': 0.6       // Slightly less transparent
        },
    });

    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
    });
    
    map.addLayer({
        id: 'bike-lanes-cambridge',
        type: 'line',
        source: 'cambridge_route',
        paint: {
          'line-color': '#0057FF', // Distinct blue
          'line-width': 3,
          'line-opacity': 0.5
        }
    });

    let jsonData;
    try {
        const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
        jsonData = await d3.json(jsonurl); 

        console.log('Loaded JSON Data:', jsonData); // Log to verify structure
    } catch (error) {
        console.error('Error loading JSON:', error); // Handle errors
    }

    let trips;
    try {
    const csvUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';
    trips = await d3.csv(
        'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
        (trip) => {
            trip.started_at = new Date(trip.started_at);
            trip.ended_at = new Date(trip.ended_at);

            let startedMinutes = minutesSinceMidnight(trip.started_at);
            departuresByMinute[startedMinutes].push(trip);
            let endedMinutes = minutesSinceMidnight(trip.ended_at);
            arrivalsByMinute[endedMinutes].push(trip);
      
            return trip;
        }
    );      
    console.log('Loaded Trips:', trips);
    } catch (error) {
    console.error('Error loading trip data:', error);
    }

    const stations = computeStationTraffic(jsonData.data.stations);
    console.log('Stations Array:', stations);
    
    console.log('Enriched Stations:', stations);

    const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

    let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

    let circles;

    const svg = d3.select('#map').append('svg')

    // Append circles to the SVG for each station
    circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name) // 🗝 Key added here
    .enter()
    .append('circle')
    .attr('r', d => radiusScale(d.totalTraffic))
    .attr('fill', 'steelblue')
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0.8)
    .style('--departure-ratio', (d) =>
        stationFlow(d.departures / d.totalTraffic),
    )
    .each(function (d) {
        d3.select(this)
        .append('title')
        .text(
            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    });



    // Function to update circle positions when the map moves/zooms
    function updatePositions() {
    circles
        .attr('cx', (d) => getCoords(d).cx) // Set the x-position using projected coordinates
        .attr('cy', (d) => getCoords(d).cy); // Set the y-position using projected coordinates
    }

    // Initial position update when map loads
    updatePositions();

    // Reposition markers on map interactions
    map.on('move', updatePositions); // Update during map movement
    map.on('zoom', updatePositions); // Update during zooming
    map.on('resize', updatePositions); // Update on window resize
    map.on('moveend', updatePositions); // Final adjustment after movement ends

    function updateScatterPlot(timeFilter) {
        const filteredStations = computeStationTraffic(stations, timeFilter);

        timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

        // Update the scatterplot by adjusting the radius of circles
        circles
          .data(filteredStations)
          .join('circle') // Ensure the data is bound correctly
          .attr('r', (d) => radiusScale(d.totalTraffic)) // Update circle sizes
          .style('--departure-ratio', (d) =>
            stationFlow(d.departures / d.totalTraffic),
          );
    }

    function updateTimeDisplay() {
        timeFilter = Number(timeSlider.value); // Get slider value
      
        if (timeFilter === -1) {
          selectedTime.textContent = ''; // Clear time display
          anyTimeLabel.style.display = 'block'; // Show "(any time)"
        } else {
          selectedTime.textContent = formatTime(timeFilter); // Display formatted time
          anyTimeLabel.style.display = 'none'; // Hide "(any time)"
        }
    
        console.log("Slider value:", timeFilter);
      
        // Call updateScatterPlot to reflect the changes on the map
        updateScatterPlot(timeFilter);
    }

    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();

});

function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
    const { x, y } = map.project(point); // Project to pixel coordinates
    return { cx: x, cy: y }; // Return as object for use in SVG attributes
}