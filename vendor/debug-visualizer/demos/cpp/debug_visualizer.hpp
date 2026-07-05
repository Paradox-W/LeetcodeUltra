#pragma once

#include <cstddef>
#include <initializer_list>
#include <iterator>
#include <sstream>
#include <string>

namespace dbgvis {

struct Marker {
    std::string id;
    std::size_t row;
    std::size_t column;
    std::size_t rows;
    std::size_t columns;
    std::string label;
    std::string color;
};

namespace detail {

inline std::string json_escape(const std::string& value) {
    std::string out;
    out.reserve(value.size() + 8);
    for (char ch : value) {
        switch (ch) {
        case '\\':
            out += "\\\\";
            break;
        case '"':
            out += "\\\"";
            break;
        case '\n':
            out += "\\n";
            break;
        case '\r':
            out += "\\r";
            break;
        case '\t':
            out += "\\t";
            break;
        default:
            out += ch;
            break;
        }
    }
    return out;
}

template <typename T>
std::string to_string(const T& value) {
    std::ostringstream stream;
    stream << value;
    return stream.str();
}

inline void write_marker(std::ostringstream& json, const Marker& marker) {
    json << "{\"id\":\"" << json_escape(marker.id) << "\""
         << ",\"row\":" << marker.row
         << ",\"column\":" << marker.column;
    if (marker.rows > 1) {
        json << ",\"rows\":" << marker.rows;
    }
    if (marker.columns > 1) {
        json << ",\"columns\":" << marker.columns;
    }
    if (!marker.label.empty()) {
        json << ",\"label\":\"" << json_escape(marker.label) << "\"";
    }
    if (!marker.color.empty()) {
        json << ",\"color\":\"" << json_escape(marker.color) << "\"";
    }
    json << "}";
}

template <typename Iterator>
std::string array_from_iterators(Iterator first, Iterator last, std::initializer_list<Marker> markers) {
    std::ostringstream json;
    json << "{\"kind\":{\"grid\":true},\"rows\":[{\"columns\":[";
    std::size_t index = 0;
    for (Iterator it = first; it != last; ++it, ++index) {
        if (index > 0) {
            json << ",";
        }
        json << "{\"content\":\"" << json_escape(to_string(*it)) << "\",\"tag\":\"" << index << "\"}";
    }
    json << "]}]";
    if (markers.size() > 0) {
        json << ",\"markers\":[";
        std::size_t markerIndex = 0;
        for (std::initializer_list<Marker>::const_iterator it = markers.begin(); it != markers.end(); ++it, ++markerIndex) {
            if (markerIndex > 0) {
                json << ",";
            }
            write_marker(json, *it);
        }
        json << "]";
    }
    json << "}";
    return json.str();
}

inline std::string error_text(const std::string& message) {
    return "{\"kind\":{\"text\":true},\"text\":\"" + json_escape(message) + "\"}";
}

} // namespace detail

inline Marker marker(std::size_t index, const std::string& label = "", const std::string& color = "") {
    Marker result;
    result.id = label.empty() ? detail::to_string(index) : label;
    result.row = 0;
    result.column = index;
    result.rows = 1;
    result.columns = 1;
    result.label = label;
    result.color = color;
    return result;
}

inline Marker range(std::size_t start, std::size_t count, const std::string& label = "", const std::string& color = "") {
    Marker result = marker(start, label, color);
    result.id = label.empty() ? ("range-" + detail::to_string(start)) : label;
    result.columns = count == 0 ? 1 : count;
    return result;
}

template <typename Iterator>
Marker marker_at(Iterator first, Iterator it, const std::string& label = "", const std::string& color = "") {
    return marker(static_cast<std::size_t>(std::distance(first, it)), label, color);
}

template <typename Iterator>
Marker range_at(Iterator first, Iterator rangeFirst, Iterator rangeLast, const std::string& label = "", const std::string& color = "") {
    return range(
        static_cast<std::size_t>(std::distance(first, rangeFirst)),
        static_cast<std::size_t>(std::distance(rangeFirst, rangeLast)),
        label,
        color
    );
}

template <typename Container>
std::string array(const Container& container) {
    using std::begin;
    using std::end;
    return detail::array_from_iterators(begin(container), end(container), {});
}

template <typename Container>
std::string array(const Container& container, std::initializer_list<Marker> markers) {
    using std::begin;
    using std::end;
    return detail::array_from_iterators(begin(container), end(container), markers);
}

template <typename T, std::size_t N>
std::string array(const T (&items)[N]) {
    return detail::array_from_iterators(items, items + N, {});
}

template <typename T, std::size_t N>
std::string array(const T (&items)[N], std::initializer_list<Marker> markers) {
    return detail::array_from_iterators(items, items + N, markers);
}

template <typename T>
std::string array(const T* ptr, std::size_t count) {
    return array(ptr, count, {});
}

template <typename T>
std::string array(const T* ptr, std::size_t count, std::initializer_list<Marker> markers) {
    if (!ptr && count > 0) {
        return detail::error_text("dbgvis::array received a null pointer with non-zero count.");
    }
    if (count == 0) {
        return detail::array_from_iterators(ptr, ptr, markers);
    }
    return detail::array_from_iterators(ptr, ptr + count, markers);
}

} // namespace dbgvis
