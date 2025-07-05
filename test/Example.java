package test;

import java.util.*;

public class Example {
    public List<String> items;  // Violation: exposed mutable state
    
    public Integer getValue() {
        return null;  // Violation: returning null
    }
}
