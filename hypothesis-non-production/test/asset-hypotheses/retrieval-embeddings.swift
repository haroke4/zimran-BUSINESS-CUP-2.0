import Foundation
import NaturalLanguage

guard let embedding = NLEmbedding.sentenceEmbedding(for: .english) else {
    FileHandle.standardError.write(Data("The macOS English sentence embedding model is unavailable.\n".utf8))
    exit(1)
}

let input = FileHandle.standardInput.readDataToEndOfFile()
let documents = try JSONDecoder().decode([String].self, from: input)
var vectors: [String: [Double]] = [:]

for document in documents {
    guard let vector = embedding.vector(for: document) else {
        FileHandle.standardError.write(Data("Unable to embed: \(document)\n".utf8))
        exit(1)
    }
    let magnitude = sqrt(vector.reduce(0) { $0 + $1 * $1 })
    vectors[document] = vector.map { $0 / magnitude }
}

FileHandle.standardOutput.write(try JSONEncoder().encode(vectors))
