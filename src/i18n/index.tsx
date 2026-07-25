import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react';

import type { AppLanguage } from '@/src/features/preferences/models';
import { useUserPreferencesStore } from '@/src/features/preferences/store';

const catalan = {
  tabs_map: 'Mapa',
  tabs_lines: 'Línies',
  tabs_alerts: 'Alertes',
  tabs_saved: 'Tu',
  saved_title: 'Tu',
  saved_subtitle: 'Les teves rutes i parades habituals.',
  saved_places: 'Llocs guardats',
  saved_home: 'Casa',
  saved_work: 'Feina',
  saved_set_place: 'Configura al mapa',
  saved_edit_place: 'Edita al mapa',
  saved_plan_from: 'Planifica des d’aquí',
  saved_favorite_stops: 'Parades favorites',
  saved_favorite_lines: 'Línies favorites',
  saved_recent: 'Recents',
  saved_empty_favorites: 'Encara no tens favorits.',
  saved_empty_recent: 'Les parades i rutes que consultis apareixeran aquí.',
  theme_system: 'Sistema',
  theme_light: 'Clar',
  theme_dark: 'Fosc',
  saved_remove: 'Elimina',
  saved_station: 'Parada',
  saved_route: 'Ruta',
  settings_title: 'Configuració',
  settings_preferences: 'Preferències',
  settings_language: 'Idioma',
  settings_appearance: 'Aparença',
  settings_privacy_data: 'Privacitat i dades',
  settings_location: 'Permís de localització',
  settings_location_granted: 'Permès mentre utilitzes l’app',
  settings_location_denied: 'Denegat · obre la configuració del sistema',
  settings_location_undetermined: 'Encara no sol·licitat',
  settings_privacy_policy: 'Política de privacitat',
  settings_delete_data: 'Elimina les dades personals de l’app',
  settings_delete_data_title: 'Eliminar les dades personals?',
  settings_delete_data_body: 'S’eliminaran Casa i Feina, els favorits, l’historial i l’última selecció. L’idioma i l’aparença es conservaran.',
  settings_cancel: 'Cancel·la',
  settings_delete: 'Elimina',
  settings_information: 'Informació',
  settings_data_sources: 'Fonts de dades',
  settings_support: 'Ajuda i contacte',
  settings_about_body: 'Barcelona en moviment. Una aplicació independent per consultar la xarxa de transport públic.',
  settings_version: 'Versió {version} ({build})',
  sources_title: 'Fonts de dades',
  sources_intro: 'MouBCN combina informació pública de diversos operadors en una única experiència.',
  sources_tmb_description: 'Catàlegs de metro i bus, arribades, parades properes, planificació de rutes i avisos de servei.',
  sources_tmb_attribution: 'Dades: Transports Metropolitans de Barcelona (TMB)',
  sources_fgc_description: 'Catàlegs, horaris, dades en temps real i avisos del servei ferroviari.',
  sources_fgc_attribution: 'Dades: Ferrocarrils de la Generalitat de Catalunya (FGC) · CC BY 4.0',
  sources_tram_description: 'Catàlegs, horaris, arribades GTFS-RT i alteracions del servei de TRAM Barcelona.',
  sources_provider_website: 'Web del proveïdor',
  sources_reuse_conditions: 'Condicions de reutilització',
  sources_disclaimer_title: 'Projecte independent',
  sources_disclaimer_body: 'MouBCN no està afiliada ni avalada per TMB, FGC o TRAM Barcelona. La disponibilitat i precisió depenen dels proveïdors originals.',
  sources_full_information: 'Consulta la informació pública completa',
  map_loading: 'S’està preparant el mapa…',
  map_error_title: 'No s’han pogut carregar les dades del mapa.',
  map_error_body: 'Comprova la connexió amb l’API i torna-ho a provar.',
  retry: 'Torna-ho a provar',
  map_select_place_title: 'Tria la ubicació de {place}',
  map_select_place_body: 'Toca un punt del mapa per desar-lo.',
  map_selected_point: 'Punt seleccionat',
  map_current_location: 'Ubicació actual',
  map_center_location: 'Centra el mapa a la teva ubicació',
  nearby_show: 'Mostra parades properes',
  nearby_hide: 'Amaga parades properes',
  nearby_configure: 'Configura les parades properes',
  nearby_filter_title: 'Filtra les parades properes',
  planner_open: 'Obre el planificador de ruta',
  planner_close: 'Tanca el planificador de ruta',
  planner_title: 'Ruta',
  planner_origin: 'Origen',
  planner_destination: 'Destí',
  planner_tap_map: 'Toca el mapa',
  planner_not_set: 'No definit',
  planner_edit: 'Edita',
  planner_use_location: 'Fes servir la meva ubicació',
  planner_location_unavailable: 'Ubicació no disponible',
  planner_plan: 'Planifica',
  planner_set_points: 'Defineix A i B al mapa i planifica la ruta.',
  planner_select_origin: 'Selecciona un origen al mapa.',
  planner_select_destination: 'Ara selecciona una destinació al mapa.',
  planner_ready: 'La ruta està preparada per planificar.',
  planner_swap: 'Intercanvia origen i destinació',
  planner_edit_origin_hint: 'Activa l’origen per canviar-lo al mapa.',
  planner_edit_destination_hint: 'Activa la destinació per canviar-la al mapa.',
  planner_expand_route: 'Obre els passos detallats de la ruta.',
  planner_marker_boarding: 'Puja a {name}',
  planner_marker_transfer: 'Transbordament a {name}',
  planner_marker_alighting: 'Baixa a {name}',
  planner_routes_found: 'S’han trobat {count} opcions de ruta.',
  planner_walk_to: 'Camina fins a {name}',
  planner_take_to: 'Agafa {route} fins a {name}',
  planner_direct: 'Directe',
  planner_transfers_one: '1 transbordament',
  planner_transfers_other: '{count} transbordaments',
  planner_calculating: 'S’estan calculant les rutes…',
  planner_unavailable: 'El planificador no està disponible',
  planner_try_later: 'Torna-ho a provar d’aquí a un moment.',
  planner_no_route: 'No s’ha trobat cap ruta',
  planner_move_point: 'Mou un dels punts i torna a planificar.',
  planner_options: 'Opcions',
  planner_walk: 'A peu',
  planner_steps: 'Passos',
  planner_walk_summary: '{duration} a peu · {distance}',
  lines_title: 'Línies',
  lines_subtitle: 'Tria una línia per veure les seves estacions.',
  metro: 'Metro',
  bus: 'Bus',
  fgc: 'FGC',
  tram: 'TRAM',
  lines_search: 'Cerca línia',
  lines_search_bus: 'Cerca línia o destí',
  lines_all: 'Totes',
  lines_loading: 'S’estan carregant les línies…',
  lines_empty: 'No hi ha línies que coincideixin.',
  lines_load_error: 'No s’han pogut carregar les línies.',
  line_accessibility: 'Línia {code}',
  line_no_service_today: 'Sense servei avui',
  line_favorite: 'Afegeix la línia als favorits',
  line_unfavorite: 'Elimina la línia dels favorits',
  station_search: 'Cerca estació',
  stations_load_error: 'No s’han pogut carregar les estacions.',
  stations_loading: 'S’estan carregant les estacions…',
  stations_empty: 'No hi ha estacions per mostrar.',
  alerts_title: 'Alertes',
  alerts_network: 'Xarxa TMB + FGC + TRAM',
  alerts_all: 'Totes',
  alerts_now: 'Ara',
  alerts_planned: 'Previstes',
  alerts_filter_time: 'Moment',
  alerts_filter_operator: 'Operador',
  alerts_mine: 'Només les meves',
  alerts_one: 'avís',
  alerts_other: 'avisos',
  alerts_summary: '{current} ara · {planned} programats',
  alerts_load_error: 'No s’han pogut actualitzar les alertes.',
  alerts_loading: 'S’estan carregant les alertes…',
  alerts_empty_service_title: 'No hi ha avisos publicats.',
  alerts_empty_service_body: 'Quan el servei publiqui un avís, apareixerà aquí.',
  alerts_empty_filtered_title: 'Cap avís coincideix amb aquests filtres.',
  alerts_empty_filtered_body: 'Canvia la combinació o torna a veure tots els avisos.',
  alerts_empty_mine_title: 'Encara no tens línies o parades preferides.',
  alerts_empty_mine_body: 'Desa’n alguna per veure només els avisos que l’afecten.',
  alerts_reset_filters: 'Mostra tots els avisos',
  alert_disruption: 'Incidència',
  alert_warning: 'Avís',
  alert_info: 'Info',
  alert_metro_bus: 'Metro + Bus',
  station_lines: 'Línies',
  station_updated: 'Actualitzat fa {seconds} s',
  station_loading_arrivals: 'S’estan carregant les arribades en temps real…',
  station_realtime_unavailable: 'Les dades en temps real no estan disponibles temporalment.',
  station_no_arrivals: 'No hi ha arribades en temps real ara mateix.',
  station_no_service_today: 'Aquesta línia no té servei programat avui.',
  station_next_bus: 'Pròxim bus',
  station_next_train: 'Pròxim tren',
  station_platform: 'Andana {platform}',
  station_direction: 'Direcció {direction}',
  station_scheduled: 'Horari programat',
  station_live: 'Temps real',
  vehicle_on_time: 'En hora',
  vehicle_delayed: 'Amb retard',
  vehicle_occupancy: 'Ocupació {percent}%',
  vehicle_next_stops: 'Properes: {stops}',
  vehicle_close: 'Tanca la informació del tren',
  station_favorite: 'Afegeix la parada als favorits',
  station_unfavorite: 'Elimina la parada dels favorits',
  back: 'Torna',
  sheet_resize: 'Arrossega per canviar la mida del panell',
  sheet_expand: 'Amplia el panell',
  sheet_collapse: 'Redueix el panell',
  language_ca: 'Català',
  language_en: 'English',
  language_es: 'Español',
  error_title: 'Alguna cosa ha fallat.',
  error_body: 'Torna-ho a provar. Si continua, reinicia l’app.',
} as const;

type TranslationKey = keyof typeof catalan;
type TranslationValues = Record<string, string | number>;
type Translations = Record<TranslationKey, string>;

const english: Translations = {
  tabs_map: 'Map', tabs_lines: 'Lines', tabs_alerts: 'Alerts', tabs_saved: 'You',
  saved_title: 'You', saved_subtitle: 'Your usual routes and stops.', saved_places: 'Saved places', saved_home: 'Home', saved_work: 'Work', saved_set_place: 'Set on map', saved_edit_place: 'Edit on map', saved_plan_from: 'Plan from here', saved_favorite_stops: 'Favourite stops', saved_favorite_lines: 'Favourite lines', saved_recent: 'Recent', saved_empty_favorites: 'You have no favourites yet.', saved_empty_recent: 'Stops and routes you view will appear here.', theme_system: 'System', theme_light: 'Light', theme_dark: 'Dark', saved_remove: 'Remove', saved_station: 'Stop', saved_route: 'Route',
  settings_title: 'Settings', settings_preferences: 'Preferences', settings_language: 'Language', settings_appearance: 'Appearance', settings_privacy_data: 'Privacy and data', settings_location: 'Location permission', settings_location_granted: 'Allowed while using the app', settings_location_denied: 'Denied · open system settings', settings_location_undetermined: 'Not requested yet', settings_privacy_policy: 'Privacy policy', settings_delete_data: 'Delete personal app data', settings_delete_data_title: 'Delete personal data?', settings_delete_data_body: 'Home and Work, favourites, history, and the last selection will be removed. Language and appearance will be kept.', settings_cancel: 'Cancel', settings_delete: 'Delete', settings_information: 'Information', settings_data_sources: 'Data sources', settings_support: 'Help and contact', settings_about_body: 'Barcelona in motion. An independent app for exploring the public transport network.', settings_version: 'Version {version} ({build})',
  sources_title: 'Data sources', sources_intro: 'MouBCN combines public information from several operators in one experience.', sources_tmb_description: 'Metro and bus catalogues, arrivals, nearby stops, route planning, and service notices.', sources_tmb_attribution: 'Data: Transports Metropolitans de Barcelona (TMB)', sources_fgc_description: 'Rail catalogues, schedules, realtime data, and service notices.', sources_fgc_attribution: 'Data: Ferrocarrils de la Generalitat de Catalunya (FGC) · CC BY 4.0', sources_tram_description: 'Catalogues, schedules, GTFS-RT arrivals, and service alterations from TRAM Barcelona.', sources_provider_website: 'Provider website', sources_reuse_conditions: 'Reuse conditions', sources_disclaimer_title: 'Independent project', sources_disclaimer_body: 'MouBCN is not affiliated with or endorsed by TMB, FGC, or TRAM Barcelona. Availability and accuracy depend on the original providers.', sources_full_information: 'View the complete public information',
  map_loading: 'Preparing live map…', map_error_title: 'Map data could not be loaded.', map_error_body: 'Check the API connection and try again.', retry: 'Retry', map_select_place_title: 'Choose the location for {place}', map_select_place_body: 'Tap a point on the map to save it.', map_selected_point: 'Selected point', map_current_location: 'Current location', map_center_location: 'Center map on your current location', nearby_show: 'Show nearby stops', nearby_hide: 'Hide nearby stops', nearby_configure: 'Configure nearby stops', nearby_filter_title: 'Filter nearby stops', planner_open: 'Open route planner', planner_close: 'Close route planner',
  planner_title: 'Route', planner_origin: 'Origin', planner_destination: 'Destination', planner_tap_map: 'Tap the map', planner_not_set: 'Not set', planner_edit: 'Edit', planner_use_location: 'Use my location', planner_location_unavailable: 'Location unavailable', planner_plan: 'Plan', planner_set_points: 'Set A and B on the map, then plan the route.', planner_select_origin: 'Select an origin on the map.', planner_select_destination: 'Now select a destination on the map.', planner_ready: 'The route is ready to plan.', planner_swap: 'Swap origin and destination', planner_edit_origin_hint: 'Activate the origin to change it on the map.', planner_edit_destination_hint: 'Activate the destination to change it on the map.', planner_expand_route: 'Open the detailed route steps.', planner_marker_boarding: 'Board at {name}', planner_marker_transfer: 'Transfer at {name}', planner_marker_alighting: 'Get off at {name}', planner_routes_found: '{count} route options found.', planner_walk_to: 'Walk to {name}', planner_take_to: 'Take {route} to {name}', planner_direct: 'Direct', planner_transfers_one: '1 transfer', planner_transfers_other: '{count} transfers', planner_calculating: 'Calculating routes…', planner_unavailable: 'Planner unavailable', planner_try_later: 'Try again in a moment.', planner_no_route: 'No route found', planner_move_point: 'Move one of the points and plan again.', planner_options: 'Options', planner_walk: 'Walk', planner_steps: 'Steps', planner_walk_summary: '{duration} walk · {distance}',
  lines_title: 'Lines', lines_subtitle: 'Choose a line to view its stations.', metro: 'Metro', bus: 'Bus', fgc: 'FGC', tram: 'TRAM', lines_search: 'Search line', lines_search_bus: 'Search line or destination', lines_all: 'All', lines_loading: 'Loading lines…', lines_empty: 'No matching lines.', lines_load_error: 'Lines could not be loaded.', line_accessibility: 'Line {code}', line_no_service_today: 'No service today', line_favorite: 'Add line to favourites', line_unfavorite: 'Remove line from favourites', station_search: 'Search stop', stations_load_error: 'Stations could not be loaded.', stations_loading: 'Loading stops…', stations_empty: 'There are no stops to show.',
  alerts_title: 'Alerts', alerts_network: 'TMB + FGC + TRAM network', alerts_all: 'All', alerts_now: 'Now', alerts_planned: 'Scheduled', alerts_filter_time: 'Time', alerts_filter_operator: 'Operator', alerts_mine: 'My alerts only', alerts_one: 'alert', alerts_other: 'alerts', alerts_summary: '{current} now · {planned} scheduled', alerts_load_error: 'Alerts could not be updated.', alerts_loading: 'Loading alerts…', alerts_empty_service_title: 'There are no published alerts.', alerts_empty_service_body: 'New service alerts will appear here.', alerts_empty_filtered_title: 'No alerts match these filters.', alerts_empty_filtered_body: 'Change the combination or return to all alerts.', alerts_empty_mine_title: 'You have no favourite lines or stops yet.', alerts_empty_mine_body: 'Save one to see only the alerts that affect it.', alerts_reset_filters: 'Show all alerts', alert_disruption: 'Disruption', alert_warning: 'Warning', alert_info: 'Info', alert_metro_bus: 'Metro + Bus',
  station_lines: 'Lines', station_updated: 'Updated {seconds}s ago', station_loading_arrivals: 'Loading realtime arrivals…', station_realtime_unavailable: 'Realtime data is temporarily unavailable.', station_no_arrivals: 'There are no realtime arrivals right now.', station_no_service_today: 'This line has no scheduled service today.', station_next_bus: 'Next bus', station_next_train: 'Next train', station_platform: 'Platform {platform}', station_direction: 'Direction {direction}', station_scheduled: 'Scheduled time', station_live: 'Live', vehicle_on_time: 'On time', vehicle_delayed: 'Delayed', vehicle_occupancy: 'Occupancy {percent}%', vehicle_next_stops: 'Next: {stops}', vehicle_close: 'Close train details', station_favorite: 'Add stop to favourites', station_unfavorite: 'Remove stop from favourites', back: 'Back', sheet_resize: 'Drag to resize the panel', sheet_expand: 'Expand the panel', sheet_collapse: 'Collapse the panel', language_ca: 'Català', language_en: 'English', language_es: 'Español', error_title: 'Something went wrong.', error_body: 'Try again. If it continues, restart the app.',
};

const spanish: Translations = {
  tabs_map: 'Mapa', tabs_lines: 'Líneas', tabs_alerts: 'Alertas', tabs_saved: 'Tú',
  saved_title: 'Tú', saved_subtitle: 'Tus rutas y paradas habituales.', saved_places: 'Lugares guardados', saved_home: 'Casa', saved_work: 'Trabajo', saved_set_place: 'Configurar en el mapa', saved_edit_place: 'Editar en el mapa', saved_plan_from: 'Planificar desde aquí', saved_favorite_stops: 'Paradas favoritas', saved_favorite_lines: 'Líneas favoritas', saved_recent: 'Reciente', saved_empty_favorites: 'Aún no tienes favoritos.', saved_empty_recent: 'Las paradas y rutas que consultes aparecerán aquí.', theme_system: 'Sistema', theme_light: 'Claro', theme_dark: 'Oscuro', saved_remove: 'Eliminar', saved_station: 'Parada', saved_route: 'Ruta',
  settings_title: 'Configuración', settings_preferences: 'Preferencias', settings_language: 'Idioma', settings_appearance: 'Apariencia', settings_privacy_data: 'Privacidad y datos', settings_location: 'Permiso de localización', settings_location_granted: 'Permitido mientras usas la aplicación', settings_location_denied: 'Denegado · abre la configuración del sistema', settings_location_undetermined: 'Todavía no solicitado', settings_privacy_policy: 'Política de privacidad', settings_delete_data: 'Eliminar los datos personales de la aplicación', settings_delete_data_title: '¿Eliminar los datos personales?', settings_delete_data_body: 'Se eliminarán Casa y Trabajo, los favoritos, el historial y la última selección. Se conservarán el idioma y la apariencia.', settings_cancel: 'Cancelar', settings_delete: 'Eliminar', settings_information: 'Información', settings_data_sources: 'Fuentes de datos', settings_support: 'Ayuda y contacto', settings_about_body: 'Barcelona en movimiento. Una aplicación independiente para consultar la red de transporte público.', settings_version: 'Versión {version} ({build})',
  sources_title: 'Fuentes de datos', sources_intro: 'MouBCN combina información pública de varios operadores en una única experiencia.', sources_tmb_description: 'Catálogos de metro y bus, llegadas, paradas cercanas, planificación de rutas y avisos de servicio.', sources_tmb_attribution: 'Datos: Transports Metropolitans de Barcelona (TMB)', sources_fgc_description: 'Catálogos, horarios, datos en tiempo real y avisos del servicio ferroviario.', sources_fgc_attribution: 'Datos: Ferrocarrils de la Generalitat de Catalunya (FGC) · CC BY 4.0', sources_tram_description: 'Catálogos, horarios, llegadas GTFS-RT y alteraciones del servicio de TRAM Barcelona.', sources_provider_website: 'Web del proveedor', sources_reuse_conditions: 'Condiciones de reutilización', sources_disclaimer_title: 'Proyecto independiente', sources_disclaimer_body: 'MouBCN no está afiliada ni respaldada por TMB, FGC o TRAM Barcelona. La disponibilidad y precisión dependen de los proveedores originales.', sources_full_information: 'Consultar la información pública completa',
  map_loading: 'Preparando el mapa en directo…', map_error_title: 'No se han podido cargar los datos del mapa.', map_error_body: 'Comprueba la conexión con la API y vuelve a intentarlo.', retry: 'Reintentar', map_select_place_title: 'Elige la ubicación de {place}', map_select_place_body: 'Toca un punto del mapa para guardarlo.', map_selected_point: 'Punto seleccionado', map_current_location: 'Ubicación actual', map_center_location: 'Centrar el mapa en tu ubicación', nearby_show: 'Mostrar paradas cercanas', nearby_hide: 'Ocultar paradas cercanas', nearby_configure: 'Configurar las paradas cercanas', nearby_filter_title: 'Filtra las paradas cercanas', planner_open: 'Abrir el planificador de rutas', planner_close: 'Cerrar el planificador de rutas',
  planner_title: 'Ruta', planner_origin: 'Origen', planner_destination: 'Destino', planner_tap_map: 'Toca el mapa', planner_not_set: 'Sin definir', planner_edit: 'Editar', planner_use_location: 'Usar mi ubicación', planner_location_unavailable: 'Ubicación no disponible', planner_plan: 'Planificar', planner_set_points: 'Define A y B en el mapa y planifica la ruta.', planner_select_origin: 'Selecciona un origen en el mapa.', planner_select_destination: 'Ahora selecciona un destino en el mapa.', planner_ready: 'La ruta está lista para planificar.', planner_swap: 'Intercambiar origen y destino', planner_edit_origin_hint: 'Activa el origen para cambiarlo en el mapa.', planner_edit_destination_hint: 'Activa el destino para cambiarlo en el mapa.', planner_expand_route: 'Abre los pasos detallados de la ruta.', planner_marker_boarding: 'Sube en {name}', planner_marker_transfer: 'Transbordo en {name}', planner_marker_alighting: 'Baja en {name}', planner_routes_found: 'Se han encontrado {count} opciones de ruta.', planner_walk_to: 'Camina hasta {name}', planner_take_to: 'Toma {route} hasta {name}', planner_direct: 'Directo', planner_transfers_one: '1 transbordo', planner_transfers_other: '{count} transbordos', planner_calculating: 'Calculando rutas…', planner_unavailable: 'El planificador no está disponible', planner_try_later: 'Vuelve a intentarlo dentro de un momento.', planner_no_route: 'No se ha encontrado ninguna ruta', planner_move_point: 'Mueve uno de los puntos y vuelve a planificar.', planner_options: 'Opciones', planner_walk: 'A pie', planner_steps: 'Pasos', planner_walk_summary: '{duration} a pie · {distance}',
  lines_title: 'Líneas', lines_subtitle: 'Elige una línea para ver sus estaciones.', metro: 'Metro', bus: 'Bus', fgc: 'FGC', tram: 'TRAM', lines_search: 'Buscar línea', lines_search_bus: 'Buscar línea o destino', lines_all: 'Todas', lines_loading: 'Cargando líneas…', lines_empty: 'No hay líneas que coincidan.', lines_load_error: 'No se han podido cargar las líneas.', line_accessibility: 'Línea {code}', line_no_service_today: 'Sin servicio hoy', line_favorite: 'Añadir línea a favoritos', line_unfavorite: 'Eliminar línea de favoritos', station_search: 'Buscar parada', stations_load_error: 'No se han podido cargar las estaciones.', stations_loading: 'Cargando paradas…', stations_empty: 'No hay paradas que mostrar.',
  alerts_title: 'Alertas', alerts_network: 'Red TMB + FGC + TRAM', alerts_all: 'Todas', alerts_now: 'Ahora', alerts_planned: 'Previstas', alerts_filter_time: 'Momento', alerts_filter_operator: 'Operador', alerts_mine: 'Solo las mías', alerts_one: 'aviso', alerts_other: 'avisos', alerts_summary: '{current} ahora · {planned} programados', alerts_load_error: 'No se han podido actualizar las alertas.', alerts_loading: 'Cargando alertas…', alerts_empty_service_title: 'No hay avisos publicados.', alerts_empty_service_body: 'Los nuevos avisos del servicio aparecerán aquí.', alerts_empty_filtered_title: 'Ningún aviso coincide con estos filtros.', alerts_empty_filtered_body: 'Cambia la combinación o vuelve a ver todos los avisos.', alerts_empty_mine_title: 'Aún no tienes líneas o paradas favoritas.', alerts_empty_mine_body: 'Guarda alguna para ver solo los avisos que la afectan.', alerts_reset_filters: 'Mostrar todos los avisos', alert_disruption: 'Incidencia', alert_warning: 'Aviso', alert_info: 'Info', alert_metro_bus: 'Metro + Bus',
  station_lines: 'Líneas', station_updated: 'Actualizado hace {seconds} s', station_loading_arrivals: 'Cargando llegadas en tiempo real…', station_realtime_unavailable: 'Los datos en tiempo real no están disponibles temporalmente.', station_no_arrivals: 'No hay llegadas en tiempo real ahora mismo.', station_no_service_today: 'Esta línea no tiene servicio programado hoy.', station_next_bus: 'Próximo bus', station_next_train: 'Próximo tren', station_platform: 'Andén {platform}', station_direction: 'Dirección {direction}', station_scheduled: 'Horario programado', station_live: 'Tiempo real', vehicle_on_time: 'En hora', vehicle_delayed: 'Con retraso', vehicle_occupancy: 'Ocupación {percent}%', vehicle_next_stops: 'Próximas: {stops}', vehicle_close: 'Cerrar la información del tren', station_favorite: 'Añadir parada a favoritos', station_unfavorite: 'Eliminar parada de favoritos', back: 'Volver', sheet_resize: 'Arrastra para cambiar el tamaño del panel', sheet_expand: 'Ampliar el panel', sheet_collapse: 'Reducir el panel', language_ca: 'Català', language_en: 'English', language_es: 'Español', error_title: 'Algo ha fallado.', error_body: 'Vuelve a intentarlo. Si continúa, reinicia la app.',
};

const translations: Record<AppLanguage, Translations> = { ca: catalan, en: english, es: spanish };

export function translate(language: AppLanguage, key: TranslationKey, values?: TranslationValues): string {
  const template = translations[language][key] ?? catalan[key];
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
}

interface AppLanguageContextValue {
  language: AppLanguage;
  t: (key: TranslationKey, values?: TranslationValues) => string;
}

const AppLanguageContext = createContext<AppLanguageContextValue>({
  language: 'ca',
  t: (key, values) => translate('ca', key, values),
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const language = useUserPreferencesStore((state) => state.language) ?? 'ca';
  const hydrate = useUserPreferencesStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const value = useMemo<AppLanguageContextValue>(
    () => ({ language, t: (key, values) => translate(language, key, values) }),
    [language],
  );

  return <AppLanguageContext.Provider value={value}>{children}</AppLanguageContext.Provider>;
}

export function useAppLanguage(): AppLanguageContextValue {
  return useContext(AppLanguageContext);
}

export function formatDateTime(language: AppLanguage, value: number): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
}
